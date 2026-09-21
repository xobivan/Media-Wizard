import * as Crypto from 'expo-crypto';
import * as MediaLibrary from 'expo-media-library/legacy';
import { getMediaFile } from './mediaAssetFile';

export type LegacyDuplicateAsset = MediaLibrary.Asset & {
  fingerprint: string;
  size: number;
};

export type LegacyDuplicateGroup = {
  mediaType: MediaLibrary.Asset['mediaType'];
  assets: LegacyDuplicateAsset[];
};

type Candidate = { asset: MediaLibrary.Asset; size: number };

/**
 * Previous duplicate detector: exact file-content matching without image
 * normalization. Kept as a fallback for slower devices or large libraries.
 */
export async function findDuplicateGroupsLegacy(
  assets: MediaLibrary.Asset[],
  onProgress?: (progress: number) => void,
): Promise<LegacyDuplicateGroup[]> {
  const candidatesByMetadata = new Map<string, Candidate[]>();

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const file = await getMediaFile(asset);
    const size = file.size;
    if (!size || size <= 0) continue;

    const metadataKey = [asset.mediaType, size, asset.width, asset.height, asset.duration].join(':');
    const candidates = candidatesByMetadata.get(metadataKey) ?? [];
    candidates.push({ asset, size });
    candidatesByMetadata.set(metadataKey, candidates);
    onProgress?.(Math.round(((index + 1) / assets.length) * 50));
  }

  const groups = new Map<string, LegacyDuplicateAsset[]>();
  const candidates = [...candidatesByMetadata.values()].filter((group) => group.length > 1).flat();

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    let fingerprint: string;
    try {
      const file = await getMediaFile(candidate.asset);
      fingerprint = file.md5 ?? [candidate.asset.filename, candidate.size, candidate.asset.duration, candidate.asset.width, candidate.asset.height].join(':');
    } catch {
      fingerprint = [candidate.asset.filename, candidate.size, candidate.asset.duration, candidate.asset.width, candidate.asset.height].join(':');
    }
    const duplicateAsset: LegacyDuplicateAsset = { ...candidate.asset, fingerprint, size: candidate.size };
    const group = groups.get(fingerprint) ?? [];
    group.push(duplicateAsset);
    groups.set(fingerprint, group);
    onProgress?.(50 + Math.round(((index + 1) / candidates.length) * 50));
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({ mediaType: group[0].mediaType, assets: group }));
}
