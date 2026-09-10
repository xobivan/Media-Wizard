import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
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
      : [asset.mediaType, size, asset.width, asset.height, asset.duration].join(':');
    const candidates = candidatesByMetadata.get(metadataKey) ?? [];
    candidates.push({ asset, size });
    candidatesByMetadata.set(metadataKey, candidates);
    onProgress?.(Math.round(((index + 1) / assets.length) * 50));
  }

  const groups = new Map<string, DuplicateAsset[]>();
  const candidates = [...candidatesByMetadata.values()].filter((group) => group.length > 1).flat();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const contents = candidate.asset.mediaType === 'photo'
      ? await getPhotoFingerprintInput(candidate.asset)
      : await getMediaFile(candidate.asset).then((file) => file.base64());
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, contents);
    const duplicateAsset: DuplicateAsset = { ...candidate.asset, fingerprint, size: candidate.size };
    const group = groups.get(fingerprint) ?? [];
    group.push(duplicateAsset);
    groups.set(fingerprint, group);
    onProgress?.(50 + Math.round(((index + 1) / candidates.length) * 50));
  }

  async function getPhotoFingerprintInput(asset: MediaLibrary.Asset): Promise<string> {
    try {
      return await normalizedPhotoBase64(asset);
    } catch {
      // Some Android media providers expose files that ImageManipulator cannot decode.
      // Fall back to exact byte matching so one unsupported image does not fail the scan.
      return getMediaFile(asset).then((file) => file.base64());
    }
  }

  async function normalizedPhotoBase64(asset: MediaLibrary.Asset): Promise<string> {
    const sourceFile = await getMediaFile(asset);
    const context = ImageManipulator.ImageManipulator.manipulate(sourceFile.uri);
    context.resize({ width: 64, height: 64 });
    const renderedImage = await context.renderAsync();
    const normalizedImage = await renderedImage.saveAsync({
      format: ImageManipulator.SaveFormat.PNG,
    });
    const contents = await new File(normalizedImage.uri).base64();
    new File(normalizedImage.uri).delete();
    return contents;
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({ mediaType: group[0].mediaType, assets: group }));
}
