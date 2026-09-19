import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { getMediaFile } from './mediaAssetFile';
import { count, timed, timedSync } from './scanProfiler';

export type DuplicateAsset = MediaLibrary.Asset & {
  fingerprint: string;
  size: number;
};

export type DuplicateGroup = {
  mediaType: MediaLibrary.Asset['mediaType'];
  assets: DuplicateAsset[];
};

type Candidate = { asset: MediaLibrary.Asset; size: number };

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
        ? [asset.mediaType, asset.width, asset.height].join(':')
        : [asset.mediaType, asset.width, asset.height, Math.round(asset.duration)].join(':');
      const candidates = candidatesByMetadata.get(metadataKey) ?? [];
      candidates.push({ asset, size });
      candidatesByMetadata.set(metadataKey, candidates);
      onProgress?.(Math.round(((index + 1) / assets.length) * 50));
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
  const PHOTO_FINGERPRINT_CONCURRENCY = 3;
  const VIDEO_FINGERPRINT_CONCURRENCY = 2;
  let completed = 0;
  const recordFingerprint = (candidate: Candidate, fingerprint: string) => {
    const duplicateAsset: DuplicateAsset = { ...candidate.asset, fingerprint, size: candidate.size };
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
  const videoFirstFrameResults: { candidate: Candidate; firstFrameFingerprint: string }[] = [];

  const inFlightPhotos = new Set<Promise<void>>();
  const inFlightVideos = new Set<Promise<void>>();
  try {
    for (const candidate of candidates) {
      if (candidate.asset.mediaType === 'video') {
        // Drain any in-flight photo work first so videos never run concurrently with photo rendering.
        if (inFlightPhotos.size > 0) await Promise.all(inFlightPhotos);

        let tracked: Promise<void>;
        tracked = (async () => {
          const firstFrameFingerprint = await timed('deep.video-first-frame.total', () => (
            getVideoFirstFrameFingerprint(candidate.asset)
          ));
          videoFirstFrameResults.push({ candidate, firstFrameFingerprint });
        })().finally(() => inFlightVideos.delete(tracked));
        inFlightVideos.add(tracked);

        if (inFlightVideos.size >= VIDEO_FINGERPRINT_CONCURRENCY) await Promise.race(inFlightVideos);
        continue;
      }

      // Drain any in-flight video work first so photos never run concurrently with video decoding.
      if (inFlightVideos.size > 0) await Promise.all(inFlightVideos);

      let tracked: Promise<void>;
      tracked = (async () => {
        const fingerprint = await timed('deep.photo-fingerprint.total', () => getPhotoFingerprint(candidate.asset));
        recordFingerprint(candidate, fingerprint);
      })().finally(() => inFlightPhotos.delete(tracked));
      inFlightPhotos.add(tracked);

      if (inFlightPhotos.size >= PHOTO_FINGERPRINT_CONCURRENCY) await Promise.race(inFlightPhotos);
    }
    if (inFlightPhotos.size > 0) await Promise.all(inFlightPhotos);
    if (inFlightVideos.size > 0) await Promise.all(inFlightVideos);
  } catch (error) {
    // Drain remaining in-flight work (ignoring further errors) before propagating the first
    // failure, so cancellation/error handling doesn't leave unhandled promise rejections behind.
    await Promise.allSettled(inFlightPhotos);
    await Promise.allSettled(inFlightVideos);
    throw error;
  }

  const videosByFirstFrame = new Map<string, { candidate: Candidate; firstFrameFingerprint: string }[]>();
  for (const result of videoFirstFrameResults) {
    const group = videosByFirstFrame.get(result.firstFrameFingerprint) ?? [];
    group.push(result);
    videosByFirstFrame.set(result.firstFrameFingerprint, group);
  }

  const inFlightVideoFull = new Set<Promise<void>>();
  try {
    for (const group of videosByFirstFrame.values()) {
      if (group.length === 1) {
        // No other video shares this first frame, so it cannot collide with anything under the
        // three-frame fingerprint either — record it directly without extracting more frames.
        recordFingerprint(group[0].candidate, group[0].firstFrameFingerprint);
        continue;
      }

      for (const { candidate } of group) {
        let tracked: Promise<void>;
        tracked = (async () => {
          const fingerprint = await timed('deep.video-fingerprint.total', () => getVideoFingerprint(candidate.asset));
          recordFingerprint(candidate, fingerprint);
        })().finally(() => inFlightVideoFull.delete(tracked));
        inFlightVideoFull.add(tracked);

        if (inFlightVideoFull.size >= VIDEO_FINGERPRINT_CONCURRENCY) await Promise.race(inFlightVideoFull);
      }
    }
    if (inFlightVideoFull.size > 0) await Promise.all(inFlightVideoFull);
  } catch (error) {
    await Promise.allSettled(inFlightVideoFull);
    throw error;
  }

  async function getPhotoFingerprint(asset: MediaLibrary.Asset): Promise<string> {
    try {
      return await normalizedPhotoFingerprint(asset);
    } catch {
      // Some Android media providers expose files that ImageManipulator cannot decode.
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

  async function getVideoFingerprint(asset: MediaLibrary.Asset): Promise<string> {
    // `createVideoPlayer` allocates a native decoder/player instance. Because we create one
    // per video while scanning a whole library, we must explicitly `release()` it in a
    // `finally` block — otherwise these native resources pile up across hundreds of videos
    // and eventually crash the app (observed as the app silently closing near the end of a
    // deep scan).
    let player: ReturnType<typeof createVideoPlayer> | null = null;
    try {
      const file = await timed('deep.video.get-media-file', () => getMediaFile(asset));
      player = await timed('deep.video.player-create', async () => createVideoPlayer(file.uri));
      const times = getVideoFrameTimes(asset);
      const thumbnails = await timed('deep.video.thumbnail-extract', () => (
        player!.generateThumbnailsAsync(times, { maxWidth: 64, maxHeight: 64 })
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

  async function getVideoFirstFrameFingerprint(asset: MediaLibrary.Asset): Promise<string> {
    // Same native decoder/player lifecycle as getVideoFingerprint, but only ever requests the
    // first of the three timestamps (`getVideoFrameTimes(asset)[0]`, always 0.1s), so its hash
    // is identical to the first component of the full three-frame fingerprint below.
    let player: ReturnType<typeof createVideoPlayer> | null = null;
    try {
      const file = await timed('deep.video.get-media-file', () => getMediaFile(asset));
      player = await timed('deep.video.player-create', async () => createVideoPlayer(file.uri));
      const [firstFrameTime] = getVideoFrameTimes(asset);
      const [thumbnail] = await timed('deep.video.first-frame-extract', () => (
        player!.generateThumbnailsAsync([firstFrameTime], { maxWidth: 64, maxHeight: 64 })
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
