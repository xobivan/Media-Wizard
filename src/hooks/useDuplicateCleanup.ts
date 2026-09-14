import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import type { DuplicateGroup } from '../services/duplicateDetection';

type DuplicateCleanupCallbacks = {
  onStorageSaved: (bytes: number) => void;
  onGroupsDeleted: (groups: DuplicateGroup[]) => void;
  onAssetsDeleted: (assets: DuplicateGroup['assets']) => void;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useDuplicateCleanup({
  onStorageSaved,
  onGroupsDeleted,
  onAssetsDeleted,
}: DuplicateCleanupCallbacks) {
  const deleteDuplicateGroup = (group: DuplicateGroup) => {
    const original = group.assets.reduce(
      (oldest, asset) => asset.creationTime < oldest.creationTime ? asset : oldest,
      group.assets[0],
    );
    const duplicates = group.assets.filter((asset) => asset.id !== original.id);

    Alert.alert(
      'Delete duplicates?',
      `Keep ${original.filename} and delete ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void MediaLibrary.deleteAssetsAsync(duplicates.map((asset) => asset.id))
              .then(() => {
                const savedBytes = duplicates.reduce((total, asset) => total + asset.size, 0);
                onStorageSaved(savedBytes);
                onGroupsDeleted([group]);
                onAssetsDeleted(duplicates);
                Alert.alert('Duplicates deleted', `${formatBytes(savedBytes)} of storage saved.`);
              })
              .catch((error: unknown) => {
                Alert.alert(
                  'Could not delete duplicates',
                  error instanceof Error ? error.message : 'The selected duplicates could not be deleted.',
                );
              });
          },
        },
      ],
    );
  };

  const deleteAllDuplicateGroups = (groups: DuplicateGroup[]) => {
    const duplicateAssets = groups.flatMap((group) => {
      const original = group.assets.reduce(
        (oldest, asset) => asset.creationTime < oldest.creationTime ? asset : oldest,
        group.assets[0],
      );
      return group.assets.filter((asset) => asset.id !== original.id);
    });

    Alert.alert(
      'Delete all duplicates?',
      `Keep one original in each group and delete ${duplicateAssets.length} duplicate${duplicateAssets.length === 1 ? '' : 's'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => {
            void MediaLibrary.deleteAssetsAsync(duplicateAssets.map((asset) => asset.id))
              .then(() => {
                const savedBytes = duplicateAssets.reduce((total, asset) => total + asset.size, 0);
                onStorageSaved(savedBytes);
                onGroupsDeleted(groups);
                onAssetsDeleted(duplicateAssets);
                Alert.alert('Duplicates deleted', `${formatBytes(savedBytes)} of storage saved.`);
              })
              .catch((error: unknown) => {
                Alert.alert(
                  'Could not delete duplicates',
                  error instanceof Error ? error.message : 'The selected duplicates could not be deleted.',
                );
              });
          },
        },
      ],
    );
  };

  return {
    deleteDuplicateGroup,
    deleteAllDuplicateGroups,
  };
}
