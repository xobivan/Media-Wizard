import * as MediaLibrary from 'expo-media-library/legacy';
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CleanupScreen } from './src/components/screens/CleanupScreen';
import { DoneScreen } from './src/components/screens/DoneScreen';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { ResultsScreen } from './src/components/screens/ResultsScreen';
import type {ResultTab} from './src/components/types/mediaWizardTypes';
import type { DuplicateGroup } from './src/services/duplicateDetection';
import { getMediaFile } from './src/services/mediaAssetFile';
import { compressVideo, type CompressionQuality, type StorageStrategy} from './src/services/smartCompression';
import { useMediaPermissions } from './src/hooks/useMediaPermissions';
import { useAlbumSelection } from './src/hooks/useAlbumSelection';
import { useLargeVideoSelection } from './src/hooks/useLargeVideoSelection';
import { useScanOperation } from './src/hooks/useScanOperation';
import { useCompressionOperation } from './src/hooks/useCompressionOperation';

type Screen = 'home' | 'results' | 'cleanup' | 'done';

export default function App() {
  const { permission, requestMediaPermission } = useMediaPermissions();
  const { source, albums, albumPickerVisible, selectedAlbum, chooseFolder, selectLibrary, selectAlbum } = useAlbumSelection();
  const { largeVideos, selectedLarge, selectedSavings, toggleSelection, selectAll, setLargeVideos, setSelectedLarge } = useLargeVideoSelection();
  const { 
    scanState, scanError, scanProgress, 
    scanMode, scannedAssets, scanSummary, 
    duplicateGroups, duplicateStorageSaved, 
    startScan: hookStartScan, abortScan, 
    confirmAbortScan, removeDeletedAssetsFromSummary, 
    setScanMode, setScannedAssets, setScanSummary, 
    setDuplicateGroups, setDuplicateStorageSaved 
  } = useScanOperation();
  const { 
    compressionProgress, compressionCurrent, 
    compressionState, compressionError, 
    compressionStorageSaved, compressionQuality, 
    storageStrategy, compressionSignal, 
    resetCompressionState, cancelCompression, 
    startCompression: hookStartCompression,
    setCompressionProgress, setCompressionCurrent, 
    setCompressionState, setCompressionError, 
    setCompressionStorageSaved, setCompressionQuality 
  } = useCompressionOperation();
  
  const [screen, setScreen] = useState<Screen>('home');
  const [tab, setTab] = useState<ResultTab>('Photos');
  const [keepOriginals, setKeepOriginals] = useState(true);

  useEffect(() => {
    const handleBackPress = () => {
      if (screen === 'results') {
        if (scanState === 'scanning') confirmScanAbort();
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

  const startScan = async () => {
    await hookStartScan(
      selectedAlbum,
      () => {
        resetCompressionState();
        setScreen('results');
      },
      (videos) => setLargeVideos(videos),
      (ids) => setSelectedLarge(ids),
    );
  };

  const abortScanAndReset = () => {
    abortScan(() => {
      resetCompressionState();
      setScreen('home');
    });
  };

  const confirmScanAbort = () => {
    confirmAbortScan(abortScanAndReset);
  };

  const startCompression = async (quality: CompressionQuality, deleteOriginals: boolean) => {
    const selectedVideos = largeVideos.filter((video) => selectedLarge.includes(video.id));
    return hookStartCompression(
      quality,
      deleteOriginals,
      selectedVideos,
      (strategy) => performCompression(quality, deleteOriginals, strategy),
    );
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

  const content = screen === 'home'
    ? <HomeScreen
        source={source}
        permission={permission}
        scanState={scanState}
        selectedAlbum={selectedAlbum}
        albums={albums}
        albumPickerVisible={albumPickerVisible}
        scanMode={scanMode}
        onScanModeChange={setScanMode}
        onSelectLibrary={selectLibrary}
        onChooseFolder={chooseFolder}
        onSelectAlbum={selectAlbum}
        onRequestPermission={() => void requestMediaPermission()}
        onStartScan={() => void startScan()}
      />
    : screen === 'results'
      ? <ResultsScreen
          tab={tab}
          scanState={scanState}
          scanProgress={scanProgress}
          scanError={scanError}
          scanSummary={scanSummary}
          estimatedSavings={estimatedSavings}
          selectedAlbum={selectedAlbum}
          selectedLarge={selectedLarge}
          largeVideos={largeVideos}
          duplicateGroups={duplicateGroups}
          onTabChange={setTab}
          onToggleLarge={toggleSelection}
          onSelectAll={selectAll}
          onRetry={() => void startScan()}
          onBack={() => void (scanState === 'scanning' ? confirmScanAbort() : setScreen('home'))}
          onAbortScan={abortScanAndReset}
          onContinue={() => {
            setCompressionState('idle');
            setCompressionProgress(0);
            setCompressionCurrent(0);
            setCompressionError(null);
            setScreen('cleanup');
          }}
          onDeleteDuplicateGroup={deleteDuplicateGroup}
          onDeleteAllDuplicateGroups={deleteAllDuplicateGroups}
        />
      : screen === 'cleanup'
        ? <CleanupScreen
            largeVideos={largeVideos}
            selectedLarge={selectedLarge}
            selectedSavings={selectedSavings}
            keepOriginals={keepOriginals}
            compressionQuality={compressionQuality}
            compressionProgress={compressionProgress}
            compressionCurrent={compressionCurrent}
            compressionState={compressionState}
            compressionError={compressionError}
            onBack={() => setScreen('results')}
            onKeepOriginalsChange={setKeepOriginals}
            onCompressionQualityChange={setCompressionQuality}
            onCancelCompression={cancelCompression}
            onStartCompression={() => void startCompression(compressionQuality, !keepOriginals)}
            onDone={() => setScreen('done')}
          />
        : <DoneScreen
            selectedSavings={compressionStorageSaved / (1024 * 1024)}
            duplicateStorageSaved={duplicateStorageSaved}
            onHome={() => {
              resetCompressionState();
              setScreen('home');
            }}
          />;

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
