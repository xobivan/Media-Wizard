import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { getMediaFile } from './mediaAssetFile';
import { count, timed, timedSync } from './scanProfiler';
import {
  getNativePhotoSignatures,
  getNativeVideoFrameSignatures,
  isNativeThumbnailSignaturesAvailable,
} from './nativeThumbnailSignatures';

export type DuplicateAsset = MediaLibrary.Asset & {
  fingerprint: string;
  size: number;
  /** True when this video's fingerprint was computed from a local poster frame because the
   *  full video file is offloaded to iCloud. The match is reliable for Pass 1 collisions
   *  but mid/end-frame verification was skipped. */
  isICloudOffloaded?: boolean;
};

export type DuplicateGroup = {
  mediaType: MediaLibrary.Asset['mediaType'];
  assets: DuplicateAsset[];
};

type Candidate = { asset: MediaLibrary.Asset; size: number };

// Native thumbnail extraction can occasionally stall forever on a corrupt or partially-backed-up
// video. Failing that one video is preferable to leaving the entire Deep Scan permanently stuck.
const VIDEO_THUMBNAIL_TIMEOUT_MS = 30_000;

export async function findDuplicateGroups(
  assets: MediaLibrary.Asset[],
  onProgress?: (progress: number) => void,
): Promise<DuplicateGroup[]> {
  const candidatesByMetadata = new Map<string, Candidate[]>();

  await timed('deep.metadata.total', async () => {
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      const file = await timed('deep.metadata.get-media-file', () => getMediaFile(asset));
      const size = file.size;
      if (!size || size <= 0) continue;

      const metadataKey = asset.mediaType === 'photo'
        // Camera rolls commonly contain thousands of photos with identical dimensions. A coarse,
        // logarithmic size bucket cheaply eliminates the clearly implausible pairs before they
        // reach ImageManipulator, while deliberately avoiding exact-size matching (which would
        // turn Deep Scan into Fast Scan and exclude ordinary re-encodes).
        ? [asset.mediaType, asset.width, asset.height, getPhotoSizeBucket(size)].join(':')
        // Videos can be re-exported at a different resolution while retaining their framing and
        // duration. Group by a reduced aspect ratio instead of exact dimensions so those copies
        // reach the existing first-frame and three-frame verification steps.
        : [asset.mediaType, getAspectRatioKey(asset.width, asset.height), Math.round(asset.duration)].join(':');
      const candidates = candidatesByMetadata.get(metadataKey) ?? [];
      candidates.push({ asset, size });
      candidatesByMetadata.set(metadataKey, candidates);
      onProgress?.(Math.round(((index + 1) / assets.length) * 50));
      // Yield to the JS event loop every 100 items so UI touches and cancellation register instantly
      if (index % 100 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  });

  const groups = new Map<string, DuplicateAsset[]>();
  const candidates = [...candidatesByMetadata.values()].filter((group) => group.length > 1).flat();
  count('deep.candidates.total', candidates.length);
  count('deep.candidates.photos', candidates.filter(({ asset }) => asset.mediaType === 'photo').length);
  count('deep.candidates.videos', candidates.filter(({ asset }) => asset.mediaType === 'video').length);

  // Photo fingerprinting is independent per-asset (its own ImageManipulator context and temp
  // file), so up to PHOTO_FINGERPRINT_CONCURRENCY photos are rendered in parallel to cut wall
  // time. Video fingerprinting is similarly independent per-asset (its own player and temp
  // files), so up to VIDEO_FINGERPRINT_CONCURRENCY videos are decoded in parallel too. Photo and
  // video work never overlap with each other, though: each pool is fully drained before the
  // other starts a new job, so we never combine in-flight image rendering with in-flight native
  // video decoders, which keeps peak memory/decoder pressure bounded on low-end devices.
  // Photo fingerprinting: when native thumbnail signatures module is available, we process photos
  // in larger parallel batches of 10 since native ContentResolver.loadThumbnail is lightweight and doesn't
  // allocate full-resolution image buffers in JS memory.
  const PHOTO_FINGERPRINT_CONCURRENCY = isNativeThumbnailSignaturesAvailable() ? 10 : 3;
  const VIDEO_FINGERPRINT_CONCURRENCY = 2;
  let completed = 0;
  const recordFingerprint = (candidate: Candidate, fingerprint: string, isICloudOffloaded?: boolean) => {
    const duplicateAsset: DuplicateAsset = { ...candidate.asset, fingerprint, size: candidate.size, isICloudOffloaded };
    const group = groups.get(fingerprint) ?? [];
    group.push(duplicateAsset);
    groups.set(fingerprint, group);
    completed += 1;
    onProgress?.(50 + Math.round((completed / candidates.length) * 50));
  };

  // Progressive video matching: a video's final fingerprint is `firstFrameHash:midFrameHash:
  // endFrameHash`, so two videos can only end up in the same group if their first-frame hash
  // already matches. Rather than extracting all three frames for every candidate video up
  // front, we extract only the first frame for every video, group by that hash, and only pay
  // for the (much more expensive) middle/end-frame extraction on videos whose first frame
  // actually collides with another video's. This keeps the final duplicate groups identical to
  // the old always-extract-three-frames approach while skipping most of the decoding work for
  // videos that can never match anything.
  const videoFirstFrameResults: { candidate: Candidate; firstFrameFingerprint: string; isICloudOffloaded?: boolean }[] = [];

  // Photo fingerprinting: Batch candidate photos together so native getNativePhotoSignatures processes
  // up to 100 URIs per single React Native bridge call, avoiding per-item JSI bridge overhead.
  const photoCandidates = candidates.filter((c) => c.asset.mediaType === 'photo');
  const videoCandidates = candidates.filter((c) => c.asset.mediaType === 'video');

  if (isNativeThumbnailSignaturesAvailable() && photoCandidates.length > 0) {
    const photoUris = photoCandidates.map((c) => c.asset.uri);
    const signatures = await timed('deep.photo.native-signature', () => (
      getNativePhotoSignatures(photoUris, (completedCount) => {
        onProgress?.(50 + Math.round((completedCount / candidates.length) * 50));
      })
    ));
    const sigMap = new Map<string, string>();
    for (const sig of signatures) {
      if (sig?.pHash) sigMap.set(sig.uri, sig.pHash);
    }

    for (const candidate of photoCandidates) {
      const pHash = sigMap.get(candidate.asset.uri);
      if (pHash) {
        recordFingerprint(candidate, pHash);
      } else {
        const fallbackFingerprint = await getPhotoFingerprint(candidate.asset);
        recordFingerprint(candidate, fallbackFingerprint);
      }
    }
  } else {
    const inFlightPhotos = new Set<Promise<void>>();
    for (const candidate of photoCandidates) {
      let tracked: Promise<void>;
      tracked = (async () => {
        const fingerprint = await timed('deep.photo-fingerprint.total', () => getPhotoFingerprint(candidate.asset));
        recordFingerprint(candidate, fingerprint);
      })().finally(() => inFlightPhotos.delete(tracked));
      inFlightPhotos.add(tracked);
      if (inFlightPhotos.size >= PHOTO_FINGERPRINT_CONCURRENCY) await Promise.race(inFlightPhotos);
    }
    if (inFlightPhotos.size > 0) await Promise.all(inFlightPhotos);
  }

  // --- Pass 1: Video First-Frame Fingerprinting ---
  if (isNativeThumbnailSignaturesAvailable() && videoCandidates.length > 0) {
    const videoUris = videoCandidates.map((c) => c.asset.uri);
    const firstFrameTimes = videoCandidates.map((c) => [getVideoFrameTimes(c.asset)[0]]);
    const signatures = await timed('deep.video-first-frame.native-batch', () => (
      getNativeVideoFrameSignatures(videoUris, firstFrameTimes, (completedCount) => {
        onProgress?.(50 + Math.round((completedCount / candidates.length) * 25));
      })
    ));

    const sigMap = new Map<string, { pHash: string; isICloudOffloaded?: boolean }>();
    for (const sig of signatures) {
      if (sig.frameHashes && sig.frameHashes.length > 0) {
        sigMap.set(sig.uri, { pHash: sig.frameHashes[0], isICloudOffloaded: sig.isICloudOffloaded });
      }
    }

    for (const candidate of videoCandidates) {
      const entry = sigMap.get(candidate.asset.uri);
      if (entry) {
        videoFirstFrameResults.push({ candidate, firstFrameFingerprint: entry.pHash, isICloudOffloaded: entry.isICloudOffloaded });
      } else {
        const fallback = await timed('deep.video-first-frame.total', () => (
          getVideoFirstFrameFingerprint(candidate.asset)
        ));
        if (fallback !== null) {
          videoFirstFrameResults.push({ candidate, firstFrameFingerprint: fallback });
        }
      }
    }
  } else {
    const inFlightVideos = new Set<Promise<void>>();
    try {
      for (const candidate of videoCandidates) {
        let tracked: Promise<void>;
        tracked = (async () => {
          const firstFrameFingerprint = await timed('deep.video-first-frame.total', () => (
            getVideoFirstFrameFingerprint(candidate.asset)
          ));
          if (firstFrameFingerprint !== null) {
            videoFirstFrameResults.push({ candidate, firstFrameFingerprint });
          }
        })().finally(() => inFlightVideos.delete(tracked));
        inFlightVideos.add(tracked);

        if (inFlightVideos.size >= VIDEO_FINGERPRINT_CONCURRENCY) await Promise.race(inFlightVideos);
      }
      if (inFlightVideos.size > 0) await Promise.all(inFlightVideos);
    } catch (error) {
      await Promise.allSettled(inFlightVideos);
      throw error;
    }
  }

  const videosByFirstFrame = new Map<string, { candidate: Candidate; firstFrameFingerprint: string; isICloudOffloaded?: boolean }[]>();
  for (const result of videoFirstFrameResults) {
    const group = videosByFirstFrame.get(result.firstFrameFingerprint) ?? [];
    group.push(result);
    videosByFirstFrame.set(result.firstFrameFingerprint, group);

  }

  // --- Pass 2: Video Mid+End Frame Fingerprinting for Collisions ---
  const collidingCandidates: { candidate: Candidate; firstFramePHash: string }[] = [];
  for (const group of videosByFirstFrame.values()) {
    if (group.length === 1) {
      // No other video shares this first frame, so it cannot collide with anything under the
      // three-frame fingerprint either — record it directly without extracting more frames.
      recordFingerprint(group[0].candidate, group[0].firstFrameFingerprint, group[0].isICloudOffloaded);
      continue;
    }

    for (const entry of group) {
      // iCloud-offloaded videos only have a poster-frame hash — the full video file is not on
      // device, so Pass 2 (AVAssetImageGenerator on mid/end frames) would fail immediately
      // with the same error as before. Record the poster-frame hash directly and skip Pass 2.
      if (entry.isICloudOffloaded) {
        recordFingerprint(entry.candidate, entry.firstFrameFingerprint, true);
      } else {
        collidingCandidates.push({ candidate: entry.candidate, firstFramePHash: entry.firstFrameFingerprint });
      }
    }
  }

  if (isNativeThumbnailSignaturesAvailable() && collidingCandidates.length > 0) {
    const collidingUris = collidingCandidates.map((c) => c.candidate.asset.uri);
    const remainingFrameTimes = collidingCandidates.map((c) => {
      const [, ...rest] = getVideoFrameTimes(c.candidate.asset);
      return rest;
    });

    const signatures = await timed('deep.video-full-fingerprint.native-batch', () => (
      getNativeVideoFrameSignatures(collidingUris, remainingFrameTimes, (completedCount) => {
        onProgress?.(75 + Math.round((completedCount / candidates.length) * 25));
      })
    ));

    const sigMap = new Map<string, string[]>();
    for (const sig of signatures) {
      if (sig.frameHashes) {
        sigMap.set(sig.uri, sig.frameHashes);
      }
    }

    for (const { candidate, firstFramePHash } of collidingCandidates) {
      const remainingHashes = sigMap.get(candidate.asset.uri);
      if (remainingHashes && remainingHashes.length > 0) {
        recordFingerprint(candidate, [firstFramePHash, ...remainingHashes].join(':'));
      } else {
        const fallback = await timed('deep.video-fingerprint.total', () => getVideoFingerprint(candidate.asset));
        if (fallback !== null) {
          recordFingerprint(candidate, fallback);
        }
      }
    }
  } else {
    const inFlightVideoFull = new Set<Promise<void>>();
    try {
      for (const { candidate } of collidingCandidates) {
        let tracked: Promise<void>;
        tracked = (async () => {
          const fingerprint = await timed('deep.video-fingerprint.total', () => getVideoFingerprint(candidate.asset));
          if (fingerprint !== null) {
            recordFingerprint(candidate, fingerprint);
          }
        })().finally(() => inFlightVideoFull.delete(tracked));
        inFlightVideoFull.add(tracked);

        if (inFlightVideoFull.size >= VIDEO_FINGERPRINT_CONCURRENCY) await Promise.race(inFlightVideoFull);
      }
      if (inFlightVideoFull.size > 0) await Promise.all(inFlightVideoFull);
    } catch (error) {
      await Promise.allSettled(inFlightVideoFull);
      throw error;
    }
  }


  async function getPhotoFingerprint(asset: MediaLibrary.Asset): Promise<string> {
    try {
      if (isNativeThumbnailSignaturesAvailable()) {
        const [signature] = await timed('deep.photo.native-signature', () => getNativePhotoSignatures([asset.uri]));
        if (signature?.pHash) {
          return signature.pHash;
        } else {
          if (__DEV__) console.warn('[NativeThumbnail] Native signature missing/failed for URI:', asset.uri, signature);
        }
      }
      return await normalizedPhotoFingerprint(asset);
    } catch {
      // Some Android media providers expose files that native loader or ImageManipulator cannot decode.
      // Fall back to exact streaming hash matching so one unsupported image does not fail the scan.
      return getStreamingFileFingerprint(asset);
    }
  }

  async function normalizedPhotoFingerprint(asset: MediaLibrary.Asset): Promise<string> {
    const sourceFile = await timed('deep.photo.get-media-file', () => getMediaFile(asset));

    const context = ImageManipulator.ImageManipulator.manipulate(sourceFile.uri);
    context.resize({ width: 64, height: 64 });
    const renderedImage = await timed('deep.photo.render', () => context.renderAsync());
    const normalizedImage = await timed('deep.photo.png-save', () => renderedImage.saveAsync({
      format: ImageManipulator.SaveFormat.PNG,
    }));
    const normalizedFile = new File(normalizedImage.uri);
    const fingerprint = timedSync('deep.photo.md5', () => normalizedFile.md5) ?? (await timed('deep.photo.sha256-fallback', async () => (
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, await normalizedFile.base64())
    )));
    await timed('deep.photo.temp-file-delete', async () => normalizedFile.delete());
    return fingerprint;
  }

  async function getStreamingFileFingerprint(asset: MediaLibrary.Asset): Promise<string> {
    try {
      const file = await getMediaFile(asset);
      const hash = file.md5;
      if (hash) return hash;
    } catch {
      // Fall back if native md5 fails
    }

    return [asset.filename, asset.duration, asset.width, asset.height].join(':');
  }

  async function getVideoFingerprint(asset: MediaLibrary.Asset): Promise<string | null> {
    // `createVideoPlayer` allocates a native decoder/player instance. Because we create one
    // per video while scanning a whole library, we must explicitly `release()` it in a
    // `finally` block — otherwise these native resources pile up across hundreds of videos
    // and eventually crash the app (observed as the app silently closing near the end of a
    // deep scan).
    let player: ReturnType<typeof createVideoPlayer> | null = null;
    try {
      const file = await timed('deep.video.get-media-file', () => getMediaFile(asset));
      // The video file is not on disk (offloaded to iCloud, corrupted thumbnail, etc.).
      // There is nothing to compare, so return null to signal the caller to skip this asset.
      if (!file.uri || file.uri.startsWith('ph://')) {
        return null;
      }
      player = await timed('deep.video.player-create', async () => createVideoPlayer(file.uri));
      const times = getVideoFrameTimes(asset);
      const thumbnails = await timed('deep.video.thumbnail-extract', () => (
        withTimeout(
          player!.generateThumbnailsAsync(times, { maxWidth: 64, maxHeight: 64 }),
          VIDEO_THUMBNAIL_TIMEOUT_MS,
          'Video thumbnail extraction timed out',
        )
      ));
      const frameHashes: string[] = [];

      for (const thumbnail of thumbnails) {
        frameHashes.push(await hashVideoFrame(thumbnail));
      }

      if (frameHashes.length === 0) throw new Error('No video frames were generated.');
      return frameHashes.join(':');
    } catch {
      return getStreamingFileFingerprint(asset);
    } finally {
      try {
        await timed('deep.video.player-release', async () => player?.release());
      } catch {
        // Ignore release failures; nothing more we can do if the native player is already gone.
      }
    }
  }

  async function getVideoFirstFrameFingerprint(asset: MediaLibrary.Asset): Promise<string | null> {
    // Same native decoder/player lifecycle as getVideoFingerprint, but only ever requests the
    // first of the three timestamps (`getVideoFrameTimes(asset)[0]`, always 0.1s), so its hash
    // is identical to the first component of the full three-frame fingerprint below.
    let player: ReturnType<typeof createVideoPlayer> | null = null;
    try {
      const file = await timed('deep.video.get-media-file', () => getMediaFile(asset));
      // The video file is not on disk (offloaded to iCloud + poster frame also unavailable).
      // There is nothing to compare, so return null to signal the caller to skip this asset
      // entirely rather than recording a meaningless metadata fingerprint.
      if (!file.uri || file.uri.startsWith('ph://')) {
        return null;
      }
      player = await timed('deep.video.player-create', async () => createVideoPlayer(file.uri));
      const [firstFrameTime] = getVideoFrameTimes(asset);
      const [thumbnail] = await timed('deep.video.first-frame-extract', () => (
        withTimeout(
          player!.generateThumbnailsAsync([firstFrameTime], { maxWidth: 64, maxHeight: 64 }),
          VIDEO_THUMBNAIL_TIMEOUT_MS,
          'Video first-frame extraction timed out',
        )
      ));
      if (!thumbnail) throw new Error('No first-frame thumbnail was generated.');
      return await hashVideoFrame(thumbnail);
    } catch {
      return getStreamingFileFingerprint(asset);
    } finally {
      try {
        await timed('deep.video.player-release', async () => player?.release());
      } catch {
        // Ignore release failures; nothing more we can do if the native player is already gone.
      }
    }
  }

  function getVideoFrameTimes(asset: MediaLibrary.Asset): number[] {
    const duration = Math.max(asset.duration, 0.2);
    return [...new Set([0.1, duration / 2, Math.max(0.1, duration - 0.1)])];
  }

  async function hashVideoFrame(thumbnail: VideoThumbnail): Promise<string> {
    const context = ImageManipulator.ImageManipulator.manipulate(thumbnail);
    const renderedImage = await timed('deep.video.frame-render', () => context.renderAsync());
    const normalizedImage = await timed('deep.video.frame-png-save', () => renderedImage.saveAsync({
      format: ImageManipulator.SaveFormat.PNG,
    }));
    const normalizedFile = new File(normalizedImage.uri);
    const frameHash = timedSync('deep.video.frame-md5', () => normalizedFile.md5) ?? await timed('deep.video.frame-sha256-fallback', async () => (
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, await normalizedFile.base64())
    ));
    await timed('deep.video.frame-temp-file-delete', async () => normalizedFile.delete());
    return frameHash;
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({ mediaType: group[0].mediaType, assets: group }));
}

function getPhotoSizeBucket(size: number): number {
  // Adjacent buckets differ by a factor of two. This is broad enough to retain likely JPEG
  // quality/metadata re-encodes, yet substantially narrows the usual single-dimension camera
  // group. Invalid sizes are already excluded before this helper is called.
  return Math.floor(Math.log2(size));
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function getAspectRatioKey(width: number, height: number): string {
  const normalizedWidth = Math.round(width);
  const normalizedHeight = Math.round(height);

  // Keep malformed assets out of a broad unknown-dimensions group.
  if (normalizedWidth <= 0 || normalizedHeight <= 0) return `${width}:${height}`;

  const divisor = greatestCommonDivisor(normalizedWidth, normalizedHeight);
  return `${normalizedWidth / divisor}:${normalizedHeight / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}
