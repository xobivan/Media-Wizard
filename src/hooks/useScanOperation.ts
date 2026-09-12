import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { ScanMode, ScanState, ScanSummary } from '../components/types/mediaWizardTypes';
import type { DuplicateGroup } from '../services/duplicateDetection';
import { findDuplicateGroups } from '../services/duplicateDetection';
import { findDuplicateGroupsLegacy } from '../services/duplicateDetectionLegacy';
import { findLargeVideos } from '../services/largeVideoDetection';
import * as MediaLibrary from 'expo-media-library/legacy';

class ScanAbortedError extends Error {}

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

  const startScan = async (
    selectedAlbum: MediaLibrary.Album | null,
    onScanStart: () => void,
    onLargeVideosDetected: (videos: any[]) => void,
    onSelectedLargeUpdate: (ids: string[]) => void,
  ) => {
    scanCancelled.current = false;
    setScanError(null);
    setScanState('scanning');
    setScanProgress(0);
    setDuplicateGroups([]);
    setScannedAssets([]);
    setDuplicateStorageSaved(0);
    onScanStart();

    try {
      let after: string | undefined;
      let photos = 0;
      let videos = 0;
      let total = 0;
      const assets: MediaLibrary.Asset[] = [];
      let hasNextPage = true;

      while (hasNextPage) {
        if (scanCancelled.current) throw new ScanAbortedError();
        const page = await MediaLibrary.getAssetsAsync({ first: 100, after, mediaType: ['photo', 'video'], album: selectedAlbum?.id });
        if (scanCancelled.current) throw new ScanAbortedError();
        photos += page.assets.filter((asset) => asset.mediaType === 'photo').length;
        videos += page.assets.filter((asset) => asset.mediaType === 'video').length;
        total += page.assets.length;
        assets.push(...page.assets);
        setScanProgress(page.totalCount > 0 ? Math.min(95, Math.round((total / page.totalCount) * 100)) : 95);
        hasNextPage = page.hasNextPage;
        after = page.endCursor;
      }

      const updateScanProgress = (progress: number) => {
        if (scanCancelled.current) throw new ScanAbortedError();
        setScanProgress(50 + Math.round(progress / 2));
      };

      const groups = scanMode === 'deep'
        ? await findDuplicateGroups(assets, updateScanProgress)
        : await findDuplicateGroupsLegacy(assets, updateScanProgress);
      if (scanCancelled.current) throw new ScanAbortedError();

      const detectedLargeVideos = await findLargeVideos(assets);
      if (scanCancelled.current) throw new ScanAbortedError();

      setDuplicateGroups(groups);
      onLargeVideosDetected(detectedLargeVideos);
      onSelectedLargeUpdate(detectedLargeVideos.map((video) => video.id));
      setScannedAssets(assets);
      setScanSummary({ photos, videos, total });
      setScanProgress(100);
      setScanState('complete');
    } catch (error) {
      if (error instanceof ScanAbortedError) return;
      setScanState('error');
      setScanError(error instanceof Error ? error.message : 'The media library could not be scanned.');
    }
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
    startScan,
    abortScan,
    confirmAbortScan,
    removeDeletedAssetsFromSummary,

    // Setters (for external updates)
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
