import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { createVideoPlayer } from 'expo-video';
import { getMediaFile } from './mediaAssetFile';

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

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const file = await getMediaFile(asset);
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

  const groups = new Map<string, DuplicateAsset[]>();
  const candidates = [...candidatesByMetadata.values()].filter((group) => group.length > 1).flat();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const fingerprint = candidate.asset.mediaType === 'photo'
      ? await getPhotoFingerprint(candidate.asset)
      : await getVideoFingerprint(candidate.asset);
    const duplicateAsset: DuplicateAsset = { ...candidate.asset, fingerprint, size: candidate.size };
    const group = groups.get(fingerprint) ?? [];
    group.push(duplicateAsset);
    groups.set(fingerprint, group);
    onProgress?.(50 + Math.round(((index + 1) / candidates.length) * 50));
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
    const sourceFile = await getMediaFile(asset);
    const context = ImageManipulator.ImageManipulator.manipulate(sourceFile.uri);
    context.resize({ width: 64, height: 64 });
    const renderedImage = await context.renderAsync();
    const normalizedImage = await renderedImage.saveAsync({
      format: ImageManipulator.SaveFormat.PNG,
    });
    const normalizedFile = new File(normalizedImage.uri);
    const fingerprint = normalizedFile.md5 ?? (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, await normalizedFile.base64()));
    normalizedFile.delete();
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
      const file = await getMediaFile(asset);
      player = createVideoPlayer(file.uri);
      const duration = Math.max(asset.duration, 0.2);
      const times = [...new Set([0.1, duration / 2, Math.max(0.1, duration - 0.1)])];
      const thumbnails = await player.generateThumbnailsAsync(times, { maxWidth: 64, maxHeight: 64 });
      const frameHashes: string[] = [];

      for (const thumbnail of thumbnails) {
        const context = ImageManipulator.ImageManipulator.manipulate(thumbnail);
        const renderedImage = await context.renderAsync();
        const normalizedImage = await renderedImage.saveAsync({
          format: ImageManipulator.SaveFormat.PNG,
        });
        const normalizedFile = new File(normalizedImage.uri);
        const frameHash = normalizedFile.md5 ?? await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          await normalizedFile.base64(),
        );
        normalizedFile.delete();
        frameHashes.push(frameHash);
      }

      if (frameHashes.length === 0) throw new Error('No video frames were generated.');
      return frameHashes.join(':');
    } catch {
      return getStreamingFileFingerprint(asset);
    } finally {
      try {
        player?.release();
      } catch {
        // Ignore release failures; nothing more we can do if the native player is already gone.
      }
    }
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({ mediaType: group[0].mediaType, assets: group }));
}
