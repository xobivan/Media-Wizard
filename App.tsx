import { StatusBar } from 'expo-status-bar';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  BackHandler,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Screen = 'home' | 'results' | 'cleanup' | 'done';
type ResultTab = 'Photos' | 'Videos' | 'Large files';
type PermissionState = 'checking' | 'granted' | 'limited' | 'denied';
type ScanState = 'idle' | 'scanning' | 'complete' | 'error';
type ScanSummary = { photos: number; videos: number; total: number };

const duplicatePhotos = [{ id: 'photo-1', name: 'IMG_4821.JPG', detail: '3 copies · 4.8 MB each', savings: 9.6 },{ id: 'photo-2', name: 'Beach sunset.HEIC', detail: '2 copies · 3.2 MB each', savings: 3.2 },
];

const duplicateVideos = [{ id: 'video-1', name: 'VID_20240812.MP4', detail: '2 copies · 182 MB each', savings: 182 },
];

const largeVideos = [{ id: 'large-1', name: 'Family holiday.mp4', detail: '1.2 GB · 4K · 08:42', savings: 420 },{ id: 'large-2', name: 'Birthday party.mov', detail: '680 MB · 1080p · 04:16', savings: 210 },{ id: 'large-3', name: 'Hiking day.mp4', detail: '340 MB · 4K · 02:51', savings: 105 },
];

function AppContent() {
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
      setPermission(response.status === 'granted'
        ? response.accessPrivileges === 'limited' ? 'limited' : 'granted'
        : 'denied');
    };

    void loadPermission();
    return () => {
      mounted = false;
    };
  }, []);

  const requestMediaPermission = async () => {
    const response = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
    setPermission(response.status === 'granted'
      ? response.accessPrivileges === 'limited' ? 'limited' : 'granted'
      : 'denied');
  };

  const selectedSavings = useMemo(
    () => largeVideos.filter((video) => selectedLarge.includes(video.id)).reduce((sum, video) => sum + video.savings, 0),
    [selectedLarge],
  );

  const chooseFolder = async () => {
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
        const page = await MediaLibrary.getAssetsAsync({
          first: 100,
          after,
          mediaType: ['photo', 'video'],
          album: selectedAlbum?.id,
        });
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

  const toggleLarge = (id: string) => {
    setSelectedLarge((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const renderResultCard = (
    item: { id: string; name: string; detail: string; savings: number },
    selectable = false,
  ) => {
    const selected = selectedLarge.includes(item.id);
    return (<Pressable
        key={item.id}
        style={[styles.mediaCard, selectable && selected && styles.mediaCardSelected]}
        onPress={() => selectable && toggleLarge(item.id)}
      ><View style={styles.thumbnail}><Text style={styles.thumbnailIcon}>{selectable ? '▶' : '▧'}</Text></View><View style={styles.mediaInfo}><Text style={styles.mediaName}>{item.name}</Text><Text style={styles.mediaDetail}>{item.detail}</Text></View>{selectable ? <View style={[styles.checkbox, selected && styles.checkboxChecked]}><Text style={styles.check}>{selected ? '✓' : ''}</Text></View> : null}</Pressable>
    );
  };

  if (screen === 'home') {
    return (<SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.container}><View style={styles.brandRow}><View style={styles.brandMark}><Text style={styles.brandMarkText}>✦</Text></View><Text style={styles.brand}>MediaWizard</Text></View><Text style={styles.eyebrow}>SMART STORAGE CLEANUP</Text><Text style={styles.heroTitle}>Make room for what matters.</Text><Text style={styles.heroCopy}>Find duplicates and shrink large videos, privately on your device.</Text><Text style={styles.sectionLabel}>Choose what to scan</Text><Pressable style={[styles.sourceCard, source === 'Entire library' && styles.sourceActive]} onPress={() => { setSource('Entire library'); setSelectedAlbum(null); }}><View style={styles.sourceIcon}><Text>▦</Text></View><View style={styles.sourceText}><Text style={styles.sourceTitle}>Entire library</Text><Text style={styles.sourceDetail}>Photos and videos on this device</Text></View><Text style={styles.radio}>{source === 'Entire library' ? '●' : '○'}</Text></Pressable><Pressable style={[styles.sourceCard, source === 'Choose a folder' && styles.sourceActive]} onPress={() => void chooseFolder()}><View style={styles.sourceIcon}><Text>□</Text></View><View style={styles.sourceText}><Text style={styles.sourceTitle}>{selectedAlbum?.title ?? 'Choose a folder'}</Text><Text style={styles.sourceDetail}>{selectedAlbum ? `${selectedAlbum.assetCount} media items` : 'Choose a device album'}</Text></View><Text style={styles.radio}>{source === 'Choose a folder' ? '●' : '○'}</Text></Pressable>{albumPickerVisible ? <View style={styles.albumPicker}><Text style={styles.permissionTitle}>Choose an album</Text>{albums.length === 0 ? <Text style={styles.permissionDetail}>No albums with media were found.</Text> : albums.map((album) => <Pressable key={album.id} style={styles.albumRow} onPress={() => { setSelectedAlbum(album); setSource('Choose a folder'); setAlbumPickerVisible(false); }}><Text style={styles.optionText}>{album.title}</Text><Text style={styles.permissionDetail}>{album.assetCount} items</Text></Pressable>)}<Pressable onPress={() => setAlbumPickerVisible(false)}><Text style={styles.permissionAction}>Cancel</Text></Pressable></View> : null}<View style={styles.privacy}><Text style={styles.privacyIcon}>✓</Text><View><Text style={styles.privacyTitle}>100% private</Text><Text style={styles.privacyCopy}>Your files never leave your device.</Text></View></View>{permission === 'checking' ? <View style={styles.permissionCard}><Text style={styles.permissionTitle}>Checking media access…</Text></View> : null}{permission === 'granted' ? <View style={styles.permissionCard}><Text style={styles.permissionIcon}>✓</Text><View><Text style={styles.permissionTitle}>Media access granted</Text><Text style={styles.permissionDetail}>MediaWizard can scan your library.</Text></View></View> : null}{permission === 'limited' ? <View style={styles.permissionCard}><Text style={styles.permissionIcon}>!</Text><View style={styles.permissionText}><Text style={styles.permissionTitle}>Limited media access</Text><Text style={styles.permissionDetail}>Only selected photos and videos are available.</Text></View><Pressable onPress={requestMediaPermission}><Text style={styles.permissionAction}>Change</Text></Pressable></View> : null}{permission === 'denied' ? <View style={styles.permissionCard}><Text style={styles.permissionIcon}>!</Text><View style={styles.permissionText}><Text style={styles.permissionTitle}>Media access is needed</Text><Text style={styles.permissionDetail}>Allow access to scan this device.</Text></View><Pressable onPress={requestMediaPermission}><Text style={styles.permissionAction}>Allow</Text></Pressable></View> : null}<Pressable style={[styles.primaryButton, (permission === 'checking' || permission === 'denied' || scanState === 'scanning') && styles.primaryButtonDisabled]} disabled={permission === 'checking' || permission === 'denied' || scanState === 'scanning'} onPress={() => void startScan()}><Text style={styles.primaryButtonText}>Scan {source.toLowerCase()}  →</Text></Pressable>{permission === 'denied' ? <Pressable style={styles.settingsButton} onPress={() => void Linking.openSettings()}><Text style={styles.settingsButtonText}>Open device settings</Text></Pressable> : null}<Text style={styles.version}>MediaWizard prototype · Local processing</Text></ScrollView></SafeAreaView>
    );
  }

  if (screen === 'results') {
    const scanning = scanState === 'scanning';
    return (<SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.container}><View style={styles.topBar}><Pressable onPress={() => setScreen('home')}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.topTitle}>Scan results</Text>{scanning ? <Text style={styles.topMeta}>{scanProgress}%</Text> : null}</View>{scanning ? <View style={styles.scanBox}><Text style={styles.scanTitle}>Looking through your library…</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${scanProgress}%` }]} /></View><Text style={styles.scanDetail}>Reading media metadata from {selectedAlbum?.title ?? 'your library'}</Text></View> : null}{scanState === 'error' ? <View style={styles.errorCard}><Text style={styles.errorTitle}>Scan could not finish</Text><Text style={styles.errorDetail}>{scanError}</Text><Pressable onPress={() => void startScan()}><Text style={styles.permissionAction}>Try again</Text></Pressable></View> : null}{!scanning && scanState !== 'error' ? <><Text style={styles.resultHeadline}>Library scan complete.</Text><Text style={styles.resultCopy}>We found {scanSummary.total} media items in {selectedAlbum?.title ?? 'your library'}.</Text><View style={styles.statRow}><View style={styles.stat}><Text style={styles.statNumber}>{scanSummary.photos}</Text><Text style={styles.statLabel}>Photos</Text></View><View style={styles.stat}><Text style={styles.statNumber}>{scanSummary.videos}</Text><Text style={styles.statLabel}>Videos</Text></View><View style={styles.stat}><Text style={styles.statNumber}>{scanSummary.total}</Text><Text style={styles.statLabel}>Total items</Text></View></View><View style={styles.tabs}>{(['Photos', 'Videos', 'Large files'] as ResultTab[]).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</View>{tab === 'Photos' ? <><Text style={styles.groupHeading}>Duplicate photos <Text style={styles.groupCount}>· next step</Text></Text>{duplicatePhotos.map((item) => renderResultCard(item))}</> : null}{tab === 'Videos' ? <><Text style={styles.groupHeading}>Duplicate videos <Text style={styles.groupCount}>· next step</Text></Text>{duplicateVideos.map((item) => renderResultCard(item))}</> : null}{tab === 'Large files' ? <><Text style={styles.groupHeading}>Large videos <Text style={styles.groupCount}>· next step</Text></Text>{largeVideos.map((item) => renderResultCard(item, true))}<Pressable style={styles.primaryButton} onPress={() => setScreen('cleanup')}><Text style={styles.primaryButtonText}>Continue to cleanup  ?</Text></Pressable></> : null}</> : null}</ScrollView></SafeAreaView>
    );
  }

  if (screen === 'cleanup') {
    return (<SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.container}><View style={styles.topBar}><Pressable onPress={() => setScreen('results')}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.topTitle}>Compress videos</Text><Text style={styles.topMeta}>{selectedLarge.length} selected</Text></View><Text style={styles.resultHeadline}>Save {Math.round(selectedSavings)} MB</Text><Text style={styles.resultCopy}>MediaWizard will use your device’s efficient video encoder and process one file at a time.</Text><Text style={styles.groupHeading}>Selected videos</Text>{largeVideos.filter((item) => selectedLarge.includes(item.id)).map((item) => renderResultCard(item, true))}<View style={styles.optionBlock}><Text style={styles.optionTitle}>After compression</Text><Pressable style={styles.optionRow} onPress={() => setKeepOriginals(true)}><Text style={styles.optionText}>Keep original files</Text><Text style={styles.radio}>{keepOriginals ? '●' : '○'}</Text></Pressable><Pressable style={styles.optionRow} onPress={() => setKeepOriginals(false)}><Text style={styles.optionText}>Delete originals after verifying</Text><Text style={styles.radio}>{!keepOriginals ? '●' : '○'}</Text></Pressable></View><View style={styles.thermalNote}><Text style={styles.privacyIcon}>◌</Text><Text style={styles.privacyCopy}>Processing pauses automatically if your phone gets hot or the battery is low.</Text></View><Pressable style={styles.primaryButton} onPress={() => setScreen('done')}><Text style={styles.primaryButtonText}>Start compression  →</Text></Pressable></ScrollView></SafeAreaView>
    );
  }

  return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}><StatusBar style="dark" /><View style={[styles.container, styles.doneContainer]}><View style={styles.doneIcon}><Text style={styles.doneIconText}>✓</Text></View><Text style={styles.heroTitle}>All done.</Text><Text style={styles.heroCopy}>Your library is a little lighter and a lot tidier.</Text><View style={styles.savedCard}><Text style={styles.savedLabel}>STORAGE SAVED</Text><Text style={styles.savedValue}>{Math.round(selectedSavings + 194)} MB</Text><Text style={styles.savedDetail}>Duplicates removed and videos compressed</Text></View><Pressable style={styles.primaryButton} onPress={() => setScreen('home')}><Text style={styles.primaryButtonText}>Back to home</Text></Pressable></View></SafeAreaView>;
}

export default function App() {
  return (<SafeAreaProvider><AppContent /></SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9F6' },
  container: { padding: 24, paddingBottom: 40 },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 48 },
  brandMark: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#183C38', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  brandMarkText: { color: '#D8F06C', fontSize: 19 },
  brand: { color: '#183C38', fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  eyebrow: { color: '#7B8D86', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  heroTitle: { color: '#183C38', fontSize: 38, lineHeight: 42, fontWeight: '700', letterSpacing: -1.3, maxWidth: 340 },
  heroCopy: { color: '#71807B', fontSize: 16, lineHeight: 24, marginTop: 14, maxWidth: 340 },
  sectionLabel: { color: '#183C38', fontSize: 14, fontWeight: '700', marginTop: 42, marginBottom: 12 },
  sourceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#E9EDE9' },
  sourceActive: { borderColor: '#B8CA55', backgroundColor: '#FCFFF2' },
  sourceIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#EEF3E5', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  sourceText: { flex: 1 }, sourceTitle: { color: '#183C38', fontSize: 15, fontWeight: '700' }, sourceDetail: { color: '#84918D', fontSize: 12, marginTop: 4 }, radio: { color: '#9AAF43', fontSize: 21 },
  privacy: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 10 }, privacyIcon: { color: '#809D3A', fontSize: 20 }, privacyTitle: { color: '#53635D', fontSize: 13, fontWeight: '700' }, privacyCopy: { color: '#94A09B', fontSize: 12, marginTop: 2 },
  primaryButton: { backgroundColor: '#183C38', minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 28 }, primaryButtonText: { color: '#F4F8E5', fontSize: 15, fontWeight: '700' }, version: { textAlign: 'center', color: '#AAB3AE', fontSize: 11, marginTop: 24 },
  primaryButtonDisabled: { opacity: 0.45 }, permissionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginTop: 18, gap: 10 }, permissionIcon: { color: '#809D3A', fontSize: 19, fontWeight: '700' }, permissionText: { flex: 1 }, permissionTitle: { color: '#53635D', fontSize: 13, fontWeight: '700' }, permissionDetail: { color: '#94A09B', fontSize: 12, marginTop: 3 }, permissionAction: { color: '#718C33', fontWeight: '700', fontSize: 13 }, settingsButton: { alignItems: 'center', marginTop: 14 }, settingsButtonText: { color: '#718C33', fontSize: 13, fontWeight: '700' },
  albumPicker: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginTop: 12 }, albumRow: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F0F2EE' }, errorCard: { backgroundColor: '#FCEFEA', borderRadius: 16, padding: 16, marginTop: 20 }, errorTitle: { color: '#9F4E40', fontSize: 14, fontWeight: '700' }, errorDetail: { color: '#B87569', fontSize: 12, marginTop: 6 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 }, back: { color: '#183C38', fontSize: 36, lineHeight: 30, marginRight: 12 }, topTitle: { flex: 1, color: '#183C38', fontSize: 19, fontWeight: '700' }, topMeta: { color: '#8B9992', fontSize: 13 },
  scanBox: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20, marginTop: 20 }, scanTitle: { color: '#183C38', fontWeight: '700', fontSize: 16 }, progressTrack: { height: 7, borderRadius: 4, backgroundColor: '#E5EBE1', overflow: 'hidden', marginTop: 20 }, progressFill: { height: '100%', backgroundColor: '#B8CA55' }, scanDetail: { color: '#8B9992', fontSize: 12, marginTop: 10 },
  resultHeadline: { color: '#183C38', fontSize: 27, fontWeight: '700', letterSpacing: -0.7 }, resultCopy: { color: '#71807B', lineHeight: 21, fontSize: 14, marginTop: 8 }, statRow: { flexDirection: 'row', gap: 8, marginTop: 24 }, stat: { flex: 1, backgroundColor: '#E9F0DF', borderRadius: 14, padding: 13 }, statNumber: { color: '#183C38', fontSize: 19, fontWeight: '700' }, statLabel: { color: '#738276', fontSize: 10, marginTop: 5 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E1E8E1', marginTop: 32, marginBottom: 22 }, tab: { paddingBottom: 12, marginRight: 22 }, tabActive: { borderBottomWidth: 2, borderBottomColor: '#9AAF43' }, tabText: { color: '#9AA59F', fontSize: 13, fontWeight: '700' }, tabTextActive: { color: '#183C38' },
  groupHeading: { color: '#183C38', fontSize: 17, fontWeight: '700', marginBottom: 12 }, groupCount: { color: '#9AA59F', fontSize: 13, fontWeight: '400' }, selectionHint: { color: '#8A9891', fontSize: 12, marginTop: -5, marginBottom: 14 },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#EEF3E5', borderRadius: 14, padding: 14, marginBottom: 12 },
  selectAllTitle: { color: '#183C38', fontSize: 14, fontWeight: '700' }, selectAllDetail: { color: '#7D8C82', fontSize: 11, marginTop: 4 },
  mediaCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 10, marginBottom: 9, borderWidth: 1, borderColor: '#ECF0EB' }, mediaCardSelected: { borderColor: '#B8CA55', backgroundColor: '#FCFFF4' }, thumbnail: { width: 50, height: 50, borderRadius: 11, backgroundColor: '#DDE8D3', alignItems: 'center', justifyContent: 'center' }, thumbnailIcon: { color: '#658052', fontSize: 20 }, mediaInfo: { flex: 1, marginLeft: 12 }, mediaName: { color: '#29463F', fontSize: 14, fontWeight: '700' }, mediaDetail: { color: '#8B9992', fontSize: 11, marginTop: 5 }, checkbox: { width: 23, height: 23, borderRadius: 7, borderWidth: 1.5, borderColor: '#C6D0C7', alignItems: 'center', justifyContent: 'center' }, checkboxChecked: { backgroundColor: '#9AAF43', borderColor: '#9AAF43' }, check: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  dangerButton: { backgroundColor: '#FCEFEA', borderRadius: 16, padding: 17, alignItems: 'center', marginTop: 20 }, dangerButtonText: { color: '#B55F4E', fontWeight: '700', fontSize: 14 }, dangerDetail: { color: '#C58A7D', fontSize: 11, marginTop: 5 },
  optionBlock: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginTop: 24 }, optionTitle: { color: '#183C38', fontSize: 14, fontWeight: '700', marginBottom: 4 }, optionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 13, borderTopWidth: 1, borderTopColor: '#F0F2EE' }, optionText: { color: '#52635C', fontSize: 14 }, thermalNote: { flexDirection: 'row', gap: 10, backgroundColor: '#EEF3E5', padding: 14, borderRadius: 14, marginTop: 16 }, doneContainer: { flex: 1, justifyContent: 'center' }, doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#DDEBC2', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }, doneIconText: { color: '#69863B', fontSize: 34 }, savedCard: { backgroundColor: '#183C38', borderRadius: 20, padding: 24, marginTop: 32 }, savedLabel: { color: '#B8CA55', fontSize: 11, letterSpacing: 1.5, fontWeight: '700' }, savedValue: { color: '#FFFFFF', fontSize: 42, fontWeight: '700', marginTop: 8 }, savedDetail: { color: '#B5C5BE', fontSize: 13, marginTop: 4 },
});
