import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CleanupScreen } from './src/components/screens/CleanupScreen';
import { DoneScreen } from './src/components/screens/DoneScreen';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { ResultsScreen } from './src/components/screens/ResultsScreen';
import type { LargeVideo, PermissionState, ResultTab, ScanState, ScanSummary } from './src/components/types/mediaWizardTypes';
import { findDuplicateGroups, type DuplicateGroup } from './src/services/duplicateDetection';
import { findLargeVideos } from './src/services/largeVideoDetection';

type Screen = 'home' | 'results' | 'cleanup' | 'done';

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

  useEffect(() => {
    const handleBackPress = () => {
      if (screen === 'results') {
        setScreen('home');
        return true;
      }
      if (screen === 'cleanup') {
        setScreen('results');
        return true;
      }
      if (screen === 'done') {
        setScreen('home');
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => subscription.remove();
  }, [screen]);

  useEffect(() => {
    let mounted = true;
    const loadPermission = async () => {
      const response = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      if (!mounted) return;
      setPermission(response.status === 'granted' ? response.accessPrivileges === 'limited' ? 'limited' : 'granted' : 'denied');
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
    setScanError(null);
    setScanState('scanning');
    setScanProgress(0);
    setScreen('results');
    try {
      let after: string | undefined;
      let photos = 0;
      let videos = 0;
      let total = 0;
      const assets: MediaLibrary.Asset[] = [];
      let hasNextPage = true;
      while (hasNextPage) {
        const page = await MediaLibrary.getAssetsAsync({ first: 100, after, mediaType: ['photo', 'video'], album: selectedAlbum?.id });
        photos += page.assets.filter((asset) => asset.mediaType === 'photo').length;
        videos += page.assets.filter((asset) => asset.mediaType === 'video').length;
        total += page.assets.length;
        assets.push(...page.assets);
        setScanProgress(page.totalCount > 0 ? Math.min(95, Math.round((total / page.totalCount) * 100)) : 95);
        hasNextPage = page.hasNextPage;
        after = page.endCursor;
      }

      const groups = await findDuplicateGroups(assets, (progress) => setScanProgress(50 + Math.round(progress / 2)));
      const detectedLargeVideos = await findLargeVideos(assets);
      setDuplicateGroups(groups);
      setLargeVideos(detectedLargeVideos);
      setSelectedLarge(detectedLargeVideos.map((video) => video.id));
      setScanSummary({ photos, videos, total });
      setScanProgress(100);
      setScanState('complete');
    } catch (error) {
      setScanState('error');
      setScanError(error instanceof Error ? error.message : 'The media library could not be scanned.');
    }
  };

  const selectedSavings = useMemo(
    () => largeVideos.filter((video) => selectedLarge.includes(video.id)).reduce((sum, video) => sum + video.savings, 0),
    [largeVideos, selectedLarge],
  );

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
    ? <HomeScreen source={source} permission={permission} scanState={scanState} selectedAlbum={selectedAlbum} albums={albums} albumPickerVisible={albumPickerVisible} onSelectLibrary={() => { setSource('Entire library'); setSelectedAlbum(null); setAlbumPickerVisible(false); }} onChooseFolder={() => void chooseFolder()} onSelectAlbum={(album) => { setSelectedAlbum(album); setSource('Choose a folder'); setAlbumPickerVisible(false); }} onRequestPermission={() => void requestMediaPermission()} onStartScan={() => void startScan()} />
    : screen === 'results'
      ? <ResultsScreen tab={tab} scanState={scanState} scanProgress={scanProgress} scanError={scanError} scanSummary={scanSummary} selectedAlbum={selectedAlbum} selectedLarge={selectedLarge} largeVideos={largeVideos} duplicateGroups={duplicateGroups} onTabChange={setTab} onToggleLarge={(id) => setSelectedLarge((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSelectAll={() => setSelectedLarge(selectedLarge.length === largeVideos.length ? [] : largeVideos.map((item) => item.id))} onRetry={() => void startScan()} onBack={() => setScreen('home')} onContinue={() => setScreen('cleanup')} onDeleteDuplicateGroup={deleteDuplicateGroup} onDeleteAllDuplicateGroups={deleteAllDuplicateGroups} />
      : screen === 'cleanup'
        ? <CleanupScreen largeVideos={largeVideos} selectedLarge={selectedLarge} selectedSavings={selectedSavings} keepOriginals={keepOriginals} onBack={() => setScreen('results')} onKeepOriginalsChange={setKeepOriginals} onDone={() => setScreen('done')} />
        : <DoneScreen selectedSavings={selectedSavings} duplicateStorageSaved={duplicateStorageSaved} onHome={() => setScreen('home')} />;

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
