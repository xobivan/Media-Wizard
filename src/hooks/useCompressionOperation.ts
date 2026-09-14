import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { CompressionQuality } from '../services/smartCompression';
import { getDeviceStorageInfo, determineStorageStrategy, type StorageStrategy } from '../services/smartCompression';

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
  };

  const cancelCompression = () => {
    compressionSignal.current.cancelled = true;
  };

  const startCompression = async (
    quality: CompressionQuality,
    deleteOriginals: boolean,
    selectedLargeVideos: any[],
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
    cancelCompression,
    startCompression,

    // Setters (for performCompression to use)
    setCompressionProgress,
    setCompressionCurrent,
    setCompressionState,
    setCompressionError,
    setCompressionStorageSaved,
    setCompressionQuality,
    setStorageStrategy,
  };
}
