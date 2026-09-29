import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { ALL_SCAN_TARGETS, type LargeVideo, type ScanMode, type ScanState, type ScanSummary, type ScanTarget } from '../components/types/mediaWizardTypes';
import type { DuplicateGroup } from '../services/duplicateDetection';
import { findDuplicateGroups } from '../services/duplicateDetection';
import { findDuplicateGroupsLegacy } from '../services/duplicateDetectionLegacy';
import { findLargeVideos } from '../services/largeVideoDetection';
import { count, report, reset, timed } from '../services/scanProfiler';
import { clearMediaFileCache } from '../services/mediaAssetFile';
import * as MediaLibrary from 'expo-media-library/legacy';

class ScanAbortedError extends Error {}

export function useScanOperation() {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanMode, setScanMode] = useState<ScanMode>('fast');
  const [scanTargets, setScanTargets] = useState<ScanTarget[]>(ALL_SCAN_TARGETS);
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
    onLargeVideosDetected: (videos: LargeVideo[]) => void,
    onSelectedLargeUpdate: (ids: string[]) => void,
  ) => {
    scanCancelled.current = false;
    reset();
    setScanError(null);
    setScanState('scanning');
    setScanProgress(0);
    setDuplicateGroups([]);
    setScannedAssets([]);
    setDuplicateStorageSaved(0);
    clearMediaFileCache();
    onScanStart();

    try {
      const scansPhotoDuplicates = scanTargets.includes('photoDuplicates');
      const scansVideoDuplicates = scanTargets.includes('videoDuplicates');
      const scansLargeVideos = scanTargets.includes('largeVideos');
      const mediaTypes: Array<'photo' | 'video'> = [
        ...(scansPhotoDuplicates ? ['photo' as const] : []),
        ...((scansVideoDuplicates || scansLargeVideos) ? ['video' as const] : []),
      ];
      let after: string | undefined;
      let photos = 0;
      let videos = 0;
      let total = 0;
      const assets: MediaLibrary.Asset[] = [];
      let hasNextPage = true;

      await timed('scan.media-library-load.total', async () => {
        while (hasNextPage) {
          if (scanCancelled.current) throw new ScanAbortedError();
          const page = await timed('scan.media-library-load.page', () => MediaLibrary.getAssetsAsync({ first: 100, after, mediaType: mediaTypes, album: selectedAlbum?.id }));
          if (scanCancelled.current) throw new ScanAbortedError();
          photos += page.assets.filter((asset) => asset.mediaType === 'photo').length;
          videos += page.assets.filter((asset) => asset.mediaType === 'video').length;
          total += page.assets.length;
          assets.push(...page.assets);
          // Reserve the remaining progress for duplicate detection. Each detector receives its
          // own non-overlapping range below, so switching from photos to videos cannot move the
          // progress bar backwards.
          setScanProgress(page.totalCount > 0 ? Math.min(30, Math.round((total / page.totalCount) * 30)) : 30);
          hasNextPage = page.hasNextPage;
          after = page.endCursor;
        }
      });

      setScanProgress(30);

      const createDuplicateProgressUpdater = (start: number, end: number) => (progress: number) => {
        if (scanCancelled.current) throw new ScanAbortedError();
        const mappedProgress = start + Math.round((progress / 100) * (end - start));
        // Fingerprint jobs complete concurrently, so retain the greatest reported value even if
        // React applies state updates out of order.
        setScanProgress((current) => Math.max(current, mappedProgress));
      };

      const photoProgressEnd = scansPhotoDuplicates && scansVideoDuplicates ? 65 : 100;
      const photoProgress = createDuplicateProgressUpdater(30, photoProgressEnd);
      const videoProgress = createDuplicateProgressUpdater(scansPhotoDuplicates ? 65 : 30, 100);

      count('scan.assets.total', assets.length);
      count('scan.assets.photos', photos);
      count('scan.assets.videos', videos);

      const detectDuplicates = scanMode === 'deep' ? findDuplicateGroups : findDuplicateGroupsLegacy;
      const photoGroups = scansPhotoDuplicates
        ? await timed(`scan.${scanMode}-photo-duplicates.total`, () => (
          detectDuplicates(assets.filter((asset) => asset.mediaType === 'photo'), photoProgress)
        ))
        : [];
      if (scansPhotoDuplicates) setScanProgress((current) => Math.max(current, photoProgressEnd));
      const videoGroups = scansVideoDuplicates
        ? await timed(`scan.${scanMode}-video-duplicates.total`, () => (
          detectDuplicates(assets.filter((asset) => asset.mediaType === 'video'), videoProgress)
        ))
        : [];
      const groups = [...photoGroups, ...videoGroups];
      if (scanCancelled.current) throw new ScanAbortedError();

      const detectedLargeVideos = scansLargeVideos
        ? await timed('scan.large-video-detection.total', () => findLargeVideos(assets))
        : [];
      if (scanCancelled.current) throw new ScanAbortedError();

      report();

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
    } finally {
      clearMediaFileCache();
    }
  };

  return {
    // State
    scanState,
    scanError,
    scanProgress,
    scanMode,
    scanTargets,
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
    setScanTargets,
    setScannedAssets,
    setScanSummary,
    setDuplicateGroups,
    setDuplicateStorageSaved,
  };
}
