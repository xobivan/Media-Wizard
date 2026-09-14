import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CleanupScreen } from './src/components/screens/CleanupScreen';
import { DoneScreen } from './src/components/screens/DoneScreen';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { ResultsScreen } from './src/components/screens/ResultsScreen';
import type {ResultTab} from './src/components/types/mediaWizardTypes';
import type { CompressionQuality, StorageStrategy} from './src/services/smartCompression';
import { calculateEstimatedSavings } from './src/services/mediaSavings';
import { useMediaPermissions } from './src/hooks/useMediaPermissions';
import { useAlbumSelection } from './src/hooks/useAlbumSelection';
import { useLargeVideoSelection } from './src/hooks/useLargeVideoSelection';
import { useScanOperation } from './src/hooks/useScanOperation';
import { useCompressionOperation } from './src/hooks/useCompressionOperation';
import { useDuplicateCleanup } from './src/hooks/useDuplicateCleanup';

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
    performCompression: hookPerformCompression,
    setCompressionProgress, setCompressionCurrent, 
    setCompressionState, setCompressionError, 
    setCompressionStorageSaved, setCompressionQuality 
  } = useCompressionOperation();
  
  const [screen, setScreen] = useState<Screen>('home');
  const [tab, setTab] = useState<ResultTab>('Photos');
  const [keepOriginals, setKeepOriginals] = useState(true);
  const { deleteDuplicateGroup, deleteAllDuplicateGroups } = useDuplicateCleanup({
    onStorageSaved: (bytes) => setDuplicateStorageSaved((current) => current + bytes),
    onGroupsDeleted: (groups) => setDuplicateGroups((current) => current.filter((candidate) => !groups.includes(candidate))),
    onAssetsDeleted: removeDeletedAssetsFromSummary,
  });

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
    const selectedVideos = largeVideos.filter((video) => selectedLarge.includes(video.id));
    
    await hookPerformCompression(
      quality,
      deleteOriginals,
      strategy,
      selectedVideos,
      scannedAssets,
      (deletedAssetIds) => {
        setLargeVideos((current) => current.filter((v) => !deletedAssetIds.includes(v.id)));
        setSelectedLarge((current) => current.filter((id) => !deletedAssetIds.includes(id)));
        setScannedAssets((current) => current.filter((a) => !deletedAssetIds.includes(a.id)));
        setScanSummary((current) => ({
          ...current,
          videos: Math.max(0, current.videos - deletedAssetIds.length),
          total: Math.max(0, current.total - deletedAssetIds.length),
        }));
      },
    );
  };


  const estimatedSavings = calculateEstimatedSavings(duplicateGroups, selectedSavings);

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
