import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { createVideoPlayer } from 'expo-video';
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
  // time. Video fingerprinting stays serial: each video allocates a native decoder/player, and
  // letting those overlap with in-flight photo work risks excessive memory/decoder pressure on
  // low-end devices.
  const PHOTO_FINGERPRINT_CONCURRENCY = 2;
  let completed = 0;
  const recordFingerprint = (candidate: Candidate, fingerprint: string) => {
    const duplicateAsset: DuplicateAsset = { ...candidate.asset, fingerprint, size: candidate.size };
    const group = groups.get(fingerprint) ?? [];
    group.push(duplicateAsset);
    groups.set(fingerprint, group);
    completed += 1;
    onProgress?.(50 + Math.round((completed / candidates.length) * 50));
  };

  const inFlightPhotos = new Set<Promise<void>>();
  try {
    for (const candidate of candidates) {
      if (candidate.asset.mediaType === 'video') {
        // Drain any in-flight photo work first so videos never run concurrently with anything else.
        if (inFlightPhotos.size > 0) await Promise.all(inFlightPhotos);
        const fingerprint = await timed('deep.video-fingerprint.total', () => getVideoFingerprint(candidate.asset));
        recordFingerprint(candidate, fingerprint);
        continue;
      }

      let tracked: Promise<void>;
      tracked = (async () => {
        const fingerprint = await timed('deep.photo-fingerprint.total', () => getPhotoFingerprint(candidate.asset));
        recordFingerprint(candidate, fingerprint);
      })().finally(() => inFlightPhotos.delete(tracked));
      inFlightPhotos.add(tracked);

      if (inFlightPhotos.size >= PHOTO_FINGERPRINT_CONCURRENCY) await Promise.race(inFlightPhotos);
    }
    if (inFlightPhotos.size > 0) await Promise.all(inFlightPhotos);
  } catch (error) {
    // Drain remaining in-flight work (ignoring further errors) before propagating the first
    // failure, so cancellation/error handling doesn't leave unhandled promise rejections behind.
    await Promise.allSettled(inFlightPhotos);
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
      const duration = Math.max(asset.duration, 0.2);
      const times = [...new Set([0.1, duration / 2, Math.max(0.1, duration - 0.1)])];
      const thumbnails = await timed('deep.video.thumbnail-extract', () => (
        player!.generateThumbnailsAsync(times, { maxWidth: 64, maxHeight: 64 })
      ));
      const frameHashes: string[] = [];

      for (const thumbnail of thumbnails) {
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
        frameHashes.push(frameHash);
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

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({ mediaType: group[0].mediaType, assets: group }));
}
