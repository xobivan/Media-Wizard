import * as MediaLibrary from 'expo-media-library/legacy';
import { File } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CleanupScreen } from './src/components/screens/CleanupScreen';
import { DoneScreen } from './src/components/screens/DoneScreen';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { ResultsScreen } from './src/components/screens/ResultsScreen';
import type { LargeVideo, PermissionState, ResultTab, ScanMode, ScanState, ScanSummary } from './src/components/types/mediaWizardTypes';
import { findDuplicateGroups, type DuplicateGroup } from './src/services/duplicateDetection';
import { findDuplicateGroupsLegacy } from './src/services/duplicateDetectionLegacy';
import { findLargeVideos } from './src/services/largeVideoDetection';
import { getMediaFile, deleteMediaFileAsync } from './src/services/mediaAssetFile';
import { compressVideo, type CompressionQuality, getDeviceStorageInfo, determineStorageStrategy, type StorageStrategy, determineMediaPermissionStrategy, type MediaPermissionStrategy } from './src/services/smartCompression';

type Screen = 'home' | 'results' | 'cleanup' | 'done';
class ScanAbortedError extends Error {}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [source, setSource] = useState('Entire library');
  const [tab, setTab] = useState<ResultTab>('Photos');
  const [largeVideos, setLargeVideos] = useState<LargeVideo[]>([]);
  const [selectedLarge, setSelectedLarge] = useState<string[]>([]);
  const [keepOriginals, setKeepOriginals] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [albumPickerVisible, setAlbumPickerVisible] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<MediaLibrary.Album | null>(null);
  const [scanSummary, setScanSummary] = useState<ScanSummary>({ photos: 0, videos: 0, total: 0 });
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateStorageSaved, setDuplicateStorageSaved] = useState(0);
  const [scanMode, setScanMode] = useState<ScanMode>('fast');
  const [scannedAssets, setScannedAssets] = useState<MediaLibrary.Asset[]>([]);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [compressionCurrent, setCompressionCurrent] = useState(0);
  const [compressionState, setCompressionState] = useState<'idle' | 'compressing' | 'complete' | 'error'>('idle');
  const [compressionError, setCompressionError] = useState<string | null>(null);
  const [compressionStorageSaved, setCompressionStorageSaved] = useState(0);
  const [compressionQuality, setCompressionQuality] = useState<CompressionQuality>('balanced');
  const [storageStrategy, setStorageStrategy] = useState<StorageStrategy | null>(null);
  const [mediaPermissionStrategy, setMediaPermissionStrategy] = useState<MediaPermissionStrategy>('fallback');
  const compressionSignal = useRef({ cancelled: false });
  const scanCancelled = useRef(false);

  const resetCompressionState = () => {
    setCompressionState('idle');
    setCompressionProgress(0);
    setCompressionCurrent(0);
    setCompressionError(null);
    setCompressionStorageSaved(0);
  };

  useEffect(() => {
    const handleBackPress = () => {
      if (screen === 'results') {
        if (scanState === 'scanning') confirmAbortScan();
        else setScreen('home');
        return true;
      }

      if (screen === 'cleanup') {
        setScreen('results');
        return true;
      }
      if (screen === 'done') {
        resetCompressionState();
        setScreen('home');
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => subscription.remove();
  }, [screen, scanState]);

  useEffect(() => {
    let mounted = true;
    const loadPermission = async () => {
      const response = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      if (!mounted) return;
      setPermission(response.status === 'granted' ? response.accessPrivileges === 'limited' ? 'limited' : 'granted' : 'denied');
      
      // Determine and request media deletion permission strategy
      const strategy = determineMediaPermissionStrategy();
      setMediaPermissionStrategy(strategy);
      
      if (strategy === 'manage_media' || strategy === 'manage_external_storage') {
        // Request the appropriate permission for seamless deletion
        try {
          await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
        } catch (error) {
          console.warn('Failed to request media permission:', error);
        }
      }
    };
    void loadPermission();
    return () => {
      mounted = false;
    };
  }, []);

  const requestMediaPermission = async () => {
    const response = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
    setPermission(response.status === 'granted' ? response.accessPrivileges === 'limited' ? 'limited' : 'granted' : 'denied');
  };

  const chooseFolder = async () => {
    setSource('Choose a folder');
    const availableAlbums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    setAlbums(availableAlbums.filter((album) => album.assetCount > 0));
    setAlbumPickerVisible(true);
  };

  const startScan = async () => {
    scanCancelled.current = false;
    setScanError(null);
    setScanState('scanning');
    setScanProgress(0);
    setDuplicateGroups([]);
    setLargeVideos([]);
    setSelectedLarge([]);
    setScannedAssets([]);
    setDuplicateStorageSaved(0);
    resetCompressionState();
    setScreen('results');
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
      setLargeVideos(detectedLargeVideos);
      setSelectedLarge(detectedLargeVideos.map((video) => video.id));
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

  const abortScan = () => {
    scanCancelled.current = true;
    setScanState('idle');
    resetCompressionState();
    setScreen('home');
  };

  const cancelCompression = () => {
    compressionSignal.current.cancelled = true;
  };

  const startCompression = async (quality: CompressionQuality, deleteOriginals: boolean) => {
    // If user chose to delete originals, check storage and ask for confirmation
    if (deleteOriginals) {
      const selectedVideos = largeVideos.filter((video) => selectedLarge.includes(video.id));
      
      // Check available storage
      const storageInfo = await getDeviceStorageInfo();
      const strategy = determineStorageStrategy(selectedVideos, storageInfo.freeBytes, quality);
      setStorageStrategy(strategy);

      const strategyMessage = strategy.deleteImmediately
        ? `⚠️ Low storage detected.\n\nYou must STAND BY YOUR PHONE while compression runs.\n\nEach video will trigger a permission dialog. You must press "Allow" for each one to free up space and continue.\n\nAvailable: ${(strategy.freeSpaceBytes / (1024 * 1024 * 1024)).toFixed(1)}GB\nEstimated needed: ${(strategy.estimatedTotalBytesNeeded / (1024 * 1024 * 1024)).toFixed(1)}GB\n\nTotal videos: ${selectedVideos.length}`
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
                void performCompression(quality, deleteOriginals, strategy).then(() => resolve());
              }
            },
          ]
        );
      });
    } else {
      return performCompression(quality, deleteOriginals, null);
    }
  };

  const performCompression = async (quality: CompressionQuality, deleteOriginals: boolean, strategy: StorageStrategy | null) => {
    compressionSignal.current = { cancelled: false };
    setCompressionState('compressing');
    setCompressionError(null);
    setCompressionProgress(0);
    setCompressionCurrent(0);
    const selectedVideos = largeVideos.filter((video) => selectedLarge.includes(video.id));
    let savedBytes = 0;
    const failures: string[] = [];
    const assetsToDelete: string[] = []; // For batch deletion (if storage sufficient)
    const successfullyDeletedAssetIds: string[] = []; // Track what was deleted
    const deleteImmediately = strategy?.deleteImmediately ?? false;

    // Single pass: Compress all videos
    for (let index = 0; index < selectedVideos.length; index += 1) {
      if (compressionSignal.current.cancelled) break;
      
      // Add delay between compressions to allow system cleanup and memory pressure to decrease
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      const video = selectedVideos[index];
      const asset = scannedAssets.find((candidate) => candidate.id === video.id);
      if (!asset) {
        failures.push(`${video.name}: source file is no longer available.`);
        continue;
      }
      setCompressionCurrent(index + 1);
      try {
        const inputFile = await getMediaFile(asset);
        const result = await compressVideo(inputFile.uri, video, quality, (progress) => {
          setCompressionProgress(Math.round(((index + progress / 100) / selectedVideos.length) * 100));
        }, compressionSignal.current);
        
        try {
          const savedAsset = await MediaLibrary.createAssetAsync(result.outputUri);
          if (!savedAsset?.id) throw new Error('The compressed video was not saved to the media library.');
        } catch (libraryError) {
          throw new Error(`Failed to save compressed video: ${libraryError instanceof Error ? libraryError.message : 'unknown error'}`);
        }
        
        try {
          new File(result.outputUri).delete();
        } catch (deleteError) {
          // Log but don't fail - temp file cleanup is not critical
          console.warn('Failed to delete temp compressed file:', deleteError);
        }
        
        // Handle original deletion based on storage strategy
        if (deleteOriginals) {
          if (deleteImmediately) {
            // Delete immediately to free up space (multiple dialogs but ensures space)
            try {
              await MediaLibrary.deleteAssetsAsync([asset.id]);
              successfullyDeletedAssetIds.push(asset.id);
            } catch (deleteError) {
              const message = deleteError instanceof Error ? deleteError.message : 'unknown error';
              if (message.includes('Permission denied') || message.includes('permission')) {
                failures.push(`${video.name}: Permission denied to delete original.`);
              } else {
                failures.push(`${video.name}: Failed to delete original - ${message}`);
              }
            }
          } else {
            // Collect for batch deletion at end (ONE permission dialog)
            assetsToDelete.push(asset.id);
          }
        }
        
        savedBytes += result.inputSizeBytes - result.outputSizeBytes;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'compression failed.';
        failures.push(`${video.name}: ${errorMessage}`);
      }
    }

    // After all compressions, delete remaining originals in batch (if strategy says so)
    if (!deleteImmediately && assetsToDelete.length > 0 && !compressionSignal.current.cancelled && deleteOriginals) {
      try {
        await MediaLibrary.deleteAssetsAsync(assetsToDelete);
        successfullyDeletedAssetIds.push(...assetsToDelete);
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : 'unknown error';
        // Only fail if user explicitly denied the permission
        if (message.includes('Permission denied') || message.includes('permission')) {
          failures.push(`Permission denied to delete ${assetsToDelete.length} original file(s). Originals were not deleted.`);
        } else {
          failures.push(`Failed to delete ${assetsToDelete.length} original file(s): ${message}`);
        }
      }
    }

    if (successfullyDeletedAssetIds.length > 0) {
      setLargeVideos((current) => current.filter((v) => !successfullyDeletedAssetIds.includes(v.id)));
      setSelectedLarge((current) => current.filter((id) => !successfullyDeletedAssetIds.includes(id)));
      setScannedAssets((current) => current.filter((a) => !successfullyDeletedAssetIds.includes(a.id)));
      setScanSummary((current) => ({
        ...current,
        videos: Math.max(0, current.videos - successfullyDeletedAssetIds.length),
        total: Math.max(0, current.total - successfullyDeletedAssetIds.length),
      }));
    }

    setCompressionStorageSaved(savedBytes);
    if (compressionSignal.current.cancelled) {
      setCompressionProgress(0);
      setCompressionState('idle');
      setCompressionError('Compression cancelled. Compressed videos were saved but originals were not deleted.');
      return;
    }
    setCompressionProgress(100);
    if (failures.length > 0) {
      setCompressionError(failures.join('\n'));
      setCompressionState('error');
    } else {
      setCompressionState('complete');
    }
  };

  const confirmAbortScan = () => {
    Alert.alert('Interrupt scan?', 'The current scan will be stopped and its partial results will be discarded.', [
      { text: 'Continue scan', style: 'cancel' },
      { text: 'Abort scan', style: 'destructive', onPress: abortScan },
    ]);
  };

  const selectedSavings = useMemo(
    () => largeVideos.filter((video) => selectedLarge.includes(video.id)).reduce((sum, video) => sum + video.savings, 0),
    [largeVideos, selectedLarge],
  );
  const estimatedSavings = duplicateGroups.reduce((total, group) => {
    const original = group.assets.reduce((oldest, asset) => asset.creationTime < oldest.creationTime ? asset : oldest, group.assets[0]);
    return total + group.assets.filter((asset) => asset.id !== original.id).reduce((sum, asset) => sum + asset.size, 0);
  }, 0) + selectedSavings * 1024 * 1024;

  const deleteDuplicateGroup = (group: DuplicateGroup) => {
    const original = group.assets.reduce((oldest, asset) => asset.creationTime < oldest.creationTime ? asset : oldest, group.assets[0]);
    const duplicates = group.assets.filter((asset) => asset.id !== original.id);
    Alert.alert('Delete duplicates?', `Keep ${original.filename} and delete ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void MediaLibrary.deleteAssetsAsync(duplicates.map((asset) => asset.id))
            .then(() => {
              const savedBytes = duplicates.reduce((total, asset) => total + asset.size, 0);
              setDuplicateStorageSaved((current) => current + savedBytes);
              setDuplicateGroups((current) => current.filter((candidate) => candidate !== group));
              removeDeletedAssetsFromSummary(duplicates);
              Alert.alert('Duplicates deleted', `${formatBytes(savedBytes)} of storage saved.`);
            })
            .catch((error: unknown) => {
              Alert.alert('Could not delete duplicates', error instanceof Error ? error.message : 'The selected duplicates could not be deleted.');
            });
        },
      },
    ]);
  };

  const deleteAllDuplicateGroups = (groups: DuplicateGroup[]) => {
    const duplicateAssets = groups.flatMap((group) => {
      const original = group.assets.reduce((oldest, asset) => asset.creationTime < oldest.creationTime ? asset : oldest, group.assets[0]);
      return group.assets.filter((asset) => asset.id !== original.id);
    });
    Alert.alert('Delete all duplicates?', `Keep one original in each group and delete ${duplicateAssets.length} duplicate${duplicateAssets.length === 1 ? '' : 's'}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: () => {
          void MediaLibrary.deleteAssetsAsync(duplicateAssets.map((asset) => asset.id))
            .then(() => {
              const savedBytes = duplicateAssets.reduce((total, asset) => total + asset.size, 0);
              setDuplicateStorageSaved((current) => current + savedBytes);
              setDuplicateGroups((current) => current.filter((candidate) => !groups.includes(candidate)));
              removeDeletedAssetsFromSummary(duplicateAssets);
              Alert.alert('Duplicates deleted', `${formatBytes(savedBytes)} of storage saved.`);
            })
            .catch((error: unknown) => {
              Alert.alert('Could not delete duplicates', error instanceof Error ? error.message : 'The selected duplicates could not be deleted.');
            });
        },
      },
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

  const content = screen === 'home'
    ? <HomeScreen source={source} permission={permission} scanState={scanState} selectedAlbum={selectedAlbum} albums={albums} albumPickerVisible={albumPickerVisible} scanMode={scanMode} onScanModeChange={setScanMode} onSelectLibrary={() => { setSource('Entire library'); setSelectedAlbum(null); setAlbumPickerVisible(false); }} onChooseFolder={() => void chooseFolder()} onSelectAlbum={(album) => { setSelectedAlbum(album); setSource('Choose a folder'); setAlbumPickerVisible(false); }} onRequestPermission={() => void requestMediaPermission()} onStartScan={() => void startScan()} />
    : screen === 'results'
      ? <ResultsScreen tab={tab} scanState={scanState} scanProgress={scanProgress} scanError={scanError} scanSummary={scanSummary} estimatedSavings={estimatedSavings} selectedAlbum={selectedAlbum} selectedLarge={selectedLarge} largeVideos={largeVideos} duplicateGroups={duplicateGroups} onTabChange={setTab} onToggleLarge={(id) => setSelectedLarge((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSelectAll={() => setSelectedLarge(selectedLarge.length === largeVideos.length ? [] : largeVideos.map((item) => item.id))} onRetry={() => void startScan()} onBack={() => void (scanState === 'scanning' ? confirmAbortScan() : setScreen('home'))} onAbortScan={abortScan} onContinue={() => { setCompressionState('idle'); setCompressionProgress(0); setCompressionCurrent(0); setCompressionError(null); setScreen('cleanup'); }} onDeleteDuplicateGroup={deleteDuplicateGroup} onDeleteAllDuplicateGroups={deleteAllDuplicateGroups} />
      : screen === 'cleanup'
        ? <CleanupScreen largeVideos={largeVideos} selectedLarge={selectedLarge} selectedSavings={selectedSavings} keepOriginals={keepOriginals} compressionQuality={compressionQuality} compressionProgress={compressionProgress} compressionCurrent={compressionCurrent} compressionState={compressionState} compressionError={compressionError} onBack={() => setScreen('results')} onKeepOriginalsChange={setKeepOriginals} onCompressionQualityChange={setCompressionQuality} onCancelCompression={cancelCompression} onStartCompression={() => void startCompression(compressionQuality, !keepOriginals)} onDone={() => setScreen('done')} />
        : <DoneScreen selectedSavings={compressionStorageSaved / (1024 * 1024)} duplicateStorageSaved={duplicateStorageSaved} onHome={() => { resetCompressionState(); setScreen('home'); }} />;

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
