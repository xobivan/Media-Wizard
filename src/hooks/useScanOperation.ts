import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { ScanMode, ScanState, ScanSummary } from '../components/types/mediaWizardTypes';
import type { DuplicateGroup } from '../services/duplicateDetection';
import * as MediaLibrary from 'expo-media-library/legacy';

export function useScanOperation() {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanMode, setScanMode] = useState<ScanMode>('fast');
  const [scannedAssets, setScannedAssets] = useState<MediaLibrary.Asset[]>([]);
  const [scanSummary, setScanSummary] = useState<ScanSummary>({ photos: 0, videos: 0, total: 0 });
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateStorageSaved, setDuplicateStorageSaved] = useState(0);
  const scanCancelled = useRef(false);

  const abortScan = (onAbort?: () => void) => {
    scanCancelled.current = true;
    setScanState('idle');
    onAbort?.();
  };

  const confirmAbortScan = (onConfirm: () => void) => {
    Alert.alert('Interrupt scan?', 'The current scan will be stopped and its partial results will be discarded.', [
      { text: 'Continue scan', style: 'cancel' },
      { text: 'Abort scan', style: 'destructive', onPress: () => onConfirm() },
    ]);
  };

  const removeDeletedAssetsFromSummary = (assets: DuplicateGroup['assets']) => {
    const deletedPhotos = assets.filter((asset) => asset.mediaType === 'photo').length;
    const deletedVideos = assets.filter((asset) => asset.mediaType === 'video').length;
    setScanSummary((current) => ({
      photos: Math.max(0, current.photos - deletedPhotos),
      videos: Math.max(0, current.videos - deletedVideos),
      total: Math.max(0, current.total - assets.length),
    }));
  };

  return {
    // State
    scanState,
    scanError,
    scanProgress,
    scanMode,
    scannedAssets,
    scanSummary,
    duplicateGroups,
    duplicateStorageSaved,
    scanCancelled,
    
    // Functions
    abortScan,
    confirmAbortScan,
    removeDeletedAssetsFromSummary,
    
    // Setters (for startScan to use)
    setScanState,
    setScanError,
    setScanProgress,
    setScanMode,
    setScannedAssets,
    setScanSummary,
    setDuplicateGroups,
    setDuplicateStorageSaved,
  };
}
