import type { DuplicateGroup } from './duplicateDetection';

const BYTES_PER_MEGABYTE = 1024 * 1024;

export function calculateEstimatedSavings(
  duplicateGroups: DuplicateGroup[],
  selectedVideoSavingsMegabytes: number,
): number {
  const duplicateSavings = duplicateGroups.reduce((total, group) => {
    const original = group.assets.reduce(
      (oldest, asset) => asset.creationTime < oldest.creationTime ? asset : oldest,
      group.assets[0],
    );

    return total + group.assets
      .filter((asset) => asset.id !== original.id)
      .reduce((sum, asset) => sum + asset.size, 0);
  }, 0);

  return duplicateSavings + selectedVideoSavingsMegabytes * BYTES_PER_MEGABYTE;
}
