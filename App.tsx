import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CleanupScreen } from './src/components/screens/CleanupScreen';
import { DoneScreen } from './src/components/screens/DoneScreen';
import { HomeScreen } from './src/components/screens/HomeScreen';
import { ResultsScreen } from './src/components/screens/ResultsScreen';
import { largeVideos } from './src/components/data/mediaWizardData';
import type { PermissionState, ResultTab, ScanState, ScanSummary } from './src/components/types/mediaWizardTypes';

type Screen = 'home' | 'results' | 'cleanup' | 'done';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [source, setSource] = useState('Entire library');
  const [tab, setTab] = useState<ResultTab>('Photos');
  const [selectedLarge, setSelectedLarge] = useState<string[]>(largeVideos.map((video) => video.id));
  const [keepOriginals, setKeepOriginals] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [albumPickerVisible, setAlbumPickerVisible] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<MediaLibrary.Album | null>(null);
  const [scanSummary, setScanSummary] = useState<ScanSummary>({ photos: 0, videos: 0, total: 0 });

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
      let hasNextPage = true;
      while (hasNextPage) {
        const page = await MediaLibrary.getAssetsAsync({ first: 100, after, mediaType: ['photo', 'video'], album: selectedAlbum?.id });
        photos += page.assets.filter((asset) => asset.mediaType === 'photo').length;
        videos += page.assets.filter((asset) => asset.mediaType === 'video').length;
        total += page.assets.length;
        setScanProgress(page.totalCount > 0 ? Math.min(95, Math.round((total / page.totalCount) * 100)) : 95);
        hasNextPage = page.hasNextPage;
        after = page.endCursor;
      }
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
    [selectedLarge],
  );

  const content = screen === 'home'
    ? <HomeScreen source={source} permission={permission} scanState={scanState} selectedAlbum={selectedAlbum} albums={albums} albumPickerVisible={albumPickerVisible} onSelectLibrary={() => { setSource('Entire library'); setSelectedAlbum(null); setAlbumPickerVisible(false); }} onChooseFolder={() => void chooseFolder()} onSelectAlbum={(album) => { setSelectedAlbum(album); setSource('Choose a folder'); setAlbumPickerVisible(false); }} onRequestPermission={() => void requestMediaPermission()} onStartScan={() => void startScan()} />
    : screen === 'results'
      ? <ResultsScreen tab={tab} scanState={scanState} scanProgress={scanProgress} scanError={scanError} scanSummary={scanSummary} selectedAlbum={selectedAlbum} selectedLarge={selectedLarge} onTabChange={setTab} onToggleLarge={(id) => setSelectedLarge((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onSelectAll={() => setSelectedLarge(selectedLarge.length === largeVideos.length ? [] : largeVideos.map((item) => item.id))} onRetry={() => void startScan()} onBack={() => setScreen('home')} onContinue={() => setScreen('cleanup')} />
      : screen === 'cleanup'
        ? <CleanupScreen selectedLarge={selectedLarge} selectedSavings={selectedSavings} keepOriginals={keepOriginals} onBack={() => setScreen('results')} onKeepOriginalsChange={setKeepOriginals} onDone={() => setScreen('done')} />
        : <DoneScreen selectedSavings={selectedSavings} onHome={() => setScreen('home')} />;

  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}
