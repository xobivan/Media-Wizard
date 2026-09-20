import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CleanupScreen } from './src/components/screens/CleanupScreen';
import { DoneScreen } from './src/components/screens/DoneScreen';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { ResultsScreen } from './src/components/screens/ResultsScreen';
import { ALL_SCAN_TARGETS, type ResultTab, type ScanTarget } from './src/components/types/mediaWizardTypes';
import type { CompressionQuality, StorageStrategy} from './src/services/smartCompression';
import { calculateEstimatedSavings } from './src/services/mediaSavings';
import { useMediaPermissions } from './src/hooks/useMediaPermissions';
import { useAlbumSelection } from './src/hooks/useAlbumSelection';
import { useLargeVideoSelection } from './src/hooks/useLargeVideoSelection';
import { useScanOperation } from './src/hooks/useScanOperation';
import { useCompressionOperation } from './src/hooks/useCompressionOperation';
import { useDuplicateCleanup } from './src/hooks/useDuplicateCleanup';
import { useAppNavigation } from './src/hooks/useAppNavigation';

export default function App() {
  const { permission, requestMediaPermission } = useMediaPermissions();
  const { source, albums, albumPickerVisible, selectedAlbum, chooseFolder, selectLibrary, selectAlbum } = useAlbumSelection();
  const { largeVideos, selectedLarge, selectedSavings, toggleSelection, selectAll, setLargeVideos, setSelectedLarge } = useLargeVideoSelection();
  const { 
    scanState, scanError, scanProgress, 
    scanMode, scanTargets, scannedAssets, scanSummary, 
    duplicateGroups, duplicateStorageSaved, 
    startScan: hookStartScan, abortScan, 
    confirmAbortScan, removeDeletedAssetsFromSummary, 
    setScanMode, setScanTargets, setScannedAssets, setScanSummary, 
    setDuplicateGroups, setDuplicateStorageSaved 
  } = useScanOperation();
  const { 
    compressionProgress, compressionCurrent, 
    compressionState, compressionError, 
    compressionStorageSaved, compressionQuality, 
    resetCompressionState, prepareCompression, cancelCompression, 
    startCompression: hookStartCompression,
    performCompression: hookPerformCompression,
    setCompressionQuality 
  } = useCompressionOperation();
  
  const [tab, setTab] = useState<ResultTab>('Photos');
  const [keepOriginals, setKeepOriginals] = useState(true);
  const { deleteDuplicateGroup, deleteAllDuplicateGroups } = useDuplicateCleanup({
    onStorageSaved: (bytes) => setDuplicateStorageSaved((current) => current + bytes),
    onGroupsDeleted: (groups) => setDuplicateGroups((current) => current.filter((candidate) => !groups.includes(candidate))),
    onAssetsDeleted: removeDeletedAssetsFromSummary,
  });

  const startScan = async () => {
    setTab(getVisibleTabs(scanTargets)[0]);
    await hookStartScan(
      selectedAlbum,
      () => {
        resetCompressionState();
        goResults();
      },
      (videos) => setLargeVideos(videos),
      (ids) => setSelectedLarge(ids),
    );
  };

  const abortScanAndReset = () => {
    abortScan(() => {
      resetCompressionState();
      goHome();
    });
  };

  const confirmScanAbort = () => {
    confirmAbortScan(abortScanAndReset);
  };

  const { screen, goHome, goResults, goCleanup, goDone } = useAppNavigation({
    scanState,
    onConfirmScanAbort: confirmScanAbort,
    onResetCompression: resetCompressionState,
  });

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
        scanTargets={scanTargets}
        onScanTargetsChange={setScanTargets}
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
          scanTargets={scanTargets}
          onTabChange={setTab}
          onToggleLarge={toggleSelection}
          onSelectAll={selectAll}
          onRetry={() => void startScan()}
          onBack={() => void (scanState === 'scanning' ? confirmScanAbort() : goHome())}
          onAbortScan={abortScanAndReset}
          onContinue={() => {
            prepareCompression();
            goCleanup();
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
            onBack={goResults}
            onKeepOriginalsChange={setKeepOriginals}
            onCompressionQualityChange={setCompressionQuality}
            onCancelCompression={cancelCompression}
            onStartCompression={() => void startCompression(compressionQuality, !keepOriginals)}
            onDone={goDone}
          />
        : <DoneScreen
            selectedSavings={compressionStorageSaved / (1024 * 1024)}
            duplicateStorageSaved={duplicateStorageSaved}
            onHome={() => {
              resetCompressionState();
              goHome();
            }}
          />;

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

function getVisibleTabs(scanTargets: ScanTarget[]): ResultTab[] {
  const tabs: ResultTab[] = [];
  if (scanTargets.includes('photoDuplicates')) tabs.push('Photos');
  if (scanTargets.includes('videoDuplicates')) tabs.push('Videos');
  if (scanTargets.includes('largeVideos')) tabs.push('Large files');
  return tabs.length > 0 ? tabs : ['Photos'];
}
