import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import { File } from 'expo-file-system';
import type { LargeVideo } from '../components/types/mediaWizardTypes';
import type { CompressionQuality } from '../services/smartCompression';
import { getDeviceStorageInfo, determineStorageStrategy, type StorageStrategy, compressVideo } from '../services/smartCompression';
import { getMediaFile, clearMediaFileCache } from '../services/mediaAssetFile';
import { count, report, reset, timed } from '../services/compressionProfiler';

export function useCompressionOperation() {
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [compressionCurrent, setCompressionCurrent] = useState(0);
  const [compressionState, setCompressionState] = useState<'idle' | 'compressing' | 'complete' | 'error'>('idle');
  const [compressionError, setCompressionError] = useState<string | null>(null);
  const [compressionStorageSaved, setCompressionStorageSaved] = useState(0);
  const [compressionQuality, setCompressionQuality] = useState<CompressionQuality>('balanced');
  const [storageStrategy, setStorageStrategy] = useState<StorageStrategy | null>(null);
  const compressionSignal = useRef({ cancelled: false });

  const resetCompressionState = () => {
    setCompressionState('idle');
    setCompressionProgress(0);
    setCompressionCurrent(0);
    setCompressionError(null);
    setCompressionStorageSaved(0);
    clearMediaFileCache();
  };

  const prepareCompression = () => {
    setCompressionState('idle');
    setCompressionProgress(0);
    setCompressionCurrent(0);
    setCompressionError(null);
  };

  const cancelCompression = () => {
    compressionSignal.current.cancelled = true;
  };

  const startCompression = async (
    quality: CompressionQuality,
    deleteOriginals: boolean,
    selectedLargeVideos: LargeVideo[],
    onCompressionConfirmed: (strategy: StorageStrategy | null) => Promise<void>,
  ) => {
    if (deleteOriginals) {
      // Check available storage
      const storageInfo = await getDeviceStorageInfo();
      const strategy = determineStorageStrategy(selectedLargeVideos, storageInfo.freeBytes, quality);
      setStorageStrategy(strategy);

      const strategyMessage = strategy.deleteImmediately
        ? `⚠️ Low storage detected.\n\nYou must STAND BY YOUR PHONE while compression runs.\n\nEach video will trigger a permission dialog. You must press "Allow" for each one to free up space and continue.\n\nAvailable: ${(strategy.freeSpaceBytes / (1024 * 1024 * 1024)).toFixed(1)}GB\nEstimated needed: ${(strategy.estimatedTotalBytesNeeded / (1024 * 1024 * 1024)).toFixed(1)}GB\n\nTotal videos: ${selectedLargeVideos.length}`
        : `After all videos are compressed, the original files will be permanently deleted.\n\nYou will see ONE permission dialog from Android at the end. Press "Allow" once to delete all originals.\n\nYou can walk away - no interaction needed during compression.`;

      return new Promise<void>((resolve) => {
        Alert.alert(
          'Delete original videos?',
          strategyMessage,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
            {
              text: 'Delete originals',
              style: 'destructive',
              onPress: () => {
                void onCompressionConfirmed(strategy).then(() => resolve());
              },
            },
          ],
        );
      });
    } else {
      return onCompressionConfirmed(null);
    }
  };

  const performCompression = async (
    quality: CompressionQuality,
    deleteOriginals: boolean,
    strategy: StorageStrategy | null,
    selectedVideos: LargeVideo[],
    scannedAssets: MediaLibrary.Asset[],
    onVideoDeleted: (deletedAssetIds: string[]) => void,
  ) => {
    compressionSignal.current = { cancelled: false };
    setCompressionState('compressing');
    setCompressionError(null);
    setCompressionProgress(0);
    setCompressionCurrent(0);
    reset();

    let savedBytes = 0;
    const failures: string[] = [];
    const assetsToDelete: string[] = [];
    const successfullyDeletedAssetIds: string[] = [];
    let permissionDeniedCount = 0;
    const deleteImmediately = strategy?.deleteImmediately ?? false;

    // Batch processing: Compress 2 videos concurrently
    const assetMap = new Map(scannedAssets.map(a => [a.id, a]));
    const BATCH_SIZE = 2;
    const progresses = new Array(selectedVideos.length).fill(0);

    for (let batchStart = 0; batchStart < selectedVideos.length; batchStart += BATCH_SIZE) {
      if (compressionSignal.current.cancelled) break;

      if (batchStart > 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const batch = selectedVideos.slice(batchStart, batchStart + BATCH_SIZE);
      
      await Promise.all(batch.map(async (video, batchIndex) => {
        if (compressionSignal.current.cancelled) return;

        const globalIndex = batchStart + batchIndex;
        // Optimistically set the current counter to the highest index we are working on
        setCompressionCurrent((current) => Math.max(current, globalIndex + 1));

        const asset = assetMap.get(video.id);
        if (!asset) {
          failures.push(`${video.name}: source file is no longer available.`);
          progresses[globalIndex] = 1;
          return;
        }

        try {
          const inputUri = video.localUri || (await timed('compression.get-media-file', () => getMediaFile(asset))).uri;
          const result = await timed(`compression.compress-video.${quality}`, () => compressVideo(inputUri, video, quality, (progress) => {
            progresses[globalIndex] = progress / 100;
            const totalProgress = progresses.reduce((a, b) => a + b, 0);
            setCompressionProgress(Math.round((totalProgress / selectedVideos.length) * 100));
          }, compressionSignal.current));

          try {
            const savedAsset = await timed('compression.save-asset', () => MediaLibrary.createAssetAsync(result.outputUri));
            if (!savedAsset?.id) throw new Error('The compressed video was not saved to the media library.');
          } catch (libraryError) {
            throw new Error(`Failed to save compressed video: ${libraryError instanceof Error ? libraryError.message : 'unknown error'}`);
          }

          try {
            new File(result.outputUri).delete();
          } catch (deleteError) {
            console.warn('Failed to delete temp compressed file:', deleteError);
          }

          if (deleteOriginals) {
            if (deleteImmediately) {
              try {
                await MediaLibrary.deleteAssetsAsync([asset.id]);
                successfullyDeletedAssetIds.push(asset.id);
              } catch (deleteError) {
                const message = deleteError instanceof Error ? deleteError.message : 'unknown error';
                permissionDeniedCount += 1;
                console.warn(`Original deletion denied or failed for ${video.name}:`, message);
              }
            } else {
              assetsToDelete.push(asset.id);
            }
          }

          savedBytes += result.inputSizeBytes - result.outputSizeBytes;
          progresses[globalIndex] = 1;
          count('compression.videos.success');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'compression failed.';
          failures.push(`${video.name}: ${errorMessage}`);
          progresses[globalIndex] = 1;
          count('compression.videos.failure');
        }
      }));
    }

    // After all compressions, delete remaining originals in batch
    if (!deleteImmediately && assetsToDelete.length > 0 && !compressionSignal.current.cancelled && deleteOriginals) {
      try {
        await MediaLibrary.deleteAssetsAsync(assetsToDelete);
        successfullyDeletedAssetIds.push(...assetsToDelete);
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : 'unknown error';
        permissionDeniedCount += assetsToDelete.length;
        console.warn('Batch original deletion denied or failed:', message);
      }
    }

    if (successfullyDeletedAssetIds.length > 0) {
      onVideoDeleted(successfullyDeletedAssetIds);
    }

    report();

    if (permissionDeniedCount > 0 && !compressionSignal.current.cancelled) {
      const videoWord = permissionDeniedCount === 1 ? 'video' : 'videos';
      Alert.alert(
        'Original Videos Kept',
        `You denied permission to delete the original ${videoWord}. Both the original and compressed ${videoWord} have been kept on your device.`,
        [{ text: 'OK' }]
      );
    }

    setCompressionStorageSaved(savedBytes);
    if (compressionSignal.current.cancelled) {
      setCompressionProgress(0);
      setCompressionState('idle');
      setCompressionError(null);
      return;
    }

    setCompressionProgress(100);
    if (failures.length > 0) {
      setCompressionError(failures.join('\n'));
      setCompressionState('error');
    } else {
      setCompressionState('complete');
    }
    clearMediaFileCache();
  };

  return {
    // State
    compressionProgress,
    compressionCurrent,
    compressionState,
    compressionError,
    compressionStorageSaved,
    compressionQuality,
    storageStrategy,
    compressionSignal,

    // Functions
    resetCompressionState,
    prepareCompression,
    cancelCompression,
    startCompression,
    performCompression,

    // Setters
    setCompressionProgress,
    setCompressionCurrent,
    setCompressionState,
    setCompressionError,
    setCompressionStorageSaved,
    setCompressionQuality,
    setStorageStrategy,
  };
}
