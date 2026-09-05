import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Screen = 'home' | 'results' | 'cleanup' | 'done';
type ResultTab = 'Photos' | 'Videos' | 'Large files';

const duplicatePhotos = [
  { id: 'photo-1', name: 'IMG_4821.JPG', detail: '3 copies · 4.8 MB each', savings: 9.6 },
  { id: 'photo-2', name: 'Beach sunset.HEIC', detail: '2 copies · 3.2 MB each', savings: 3.2 },
];

const duplicateVideos = [
  { id: 'video-1', name: 'VID_20240812.MP4', detail: '2 copies · 182 MB each', savings: 182 },
];

const largeVideos = [
  { id: 'large-1', name: 'Family holiday.mp4', detail: '1.2 GB · 4K · 08:42', savings: 420 },
  { id: 'large-2', name: 'Birthday party.mov', detail: '680 MB · 1080p · 04:16', savings: 210 },
  { id: 'large-3', name: 'Hiking day.mp4', detail: '340 MB · 4K · 02:51', savings: 105 },
];

function AppContent() {
  const [screen, setScreen] = useState<Screen>('home');
  const [source, setSource] = useState('Entire library');
  const [tab, setTab] = useState<ResultTab>('Photos');
  const [selectedLarge, setSelectedLarge] = useState<string[]>(largeVideos.map((video) => video.id));
  const [keepOriginals, setKeepOriginals] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);

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

  const selectedSavings = useMemo(
    () => largeVideos.filter((video) => selectedLarge.includes(video.id)).reduce((sum, video) => sum + video.savings, 0),
    [selectedLarge],
  );

  const startScan = () => {
    setScanProgress(0);
    setScreen('results');
    let progress = 0;
    const timer = setInterval(() => {
      progress += 25;
      setScanProgress(progress);
      if (progress >= 100) clearInterval(timer);
    }, 180);
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
    return (
      <Pressable
        key={item.id}
        style={[styles.mediaCard, selectable && selected && styles.mediaCardSelected]}
        onPress={() => selectable && toggleLarge(item.id)}
      >
        <View style={styles.thumbnail}>
          <Text style={styles.thumbnailIcon}>{selectable ? '▶' : '▧'}</Text>
        </View>
        <View style={styles.mediaInfo}>
          <Text style={styles.mediaName}>{item.name}</Text>
          <Text style={styles.mediaDetail}>{item.detail}</Text>
        </View>
        {selectable ? <View style={[styles.checkbox, selected && styles.checkboxChecked]}><Text style={styles.check}>{selected ? '✓' : ''}</Text></View> : null}
      </Pressable>
    );
  };

  if (screen === 'home') {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.brandRow}><View style={styles.brandMark}><Text style={styles.brandMarkText}>✦</Text></View><Text style={styles.brand}>MediaWizard</Text></View>
          <Text style={styles.eyebrow}>SMART STORAGE CLEANUP</Text>
          <Text style={styles.heroTitle}>Make room for what matters.</Text>
          <Text style={styles.heroCopy}>Find duplicates and shrink large videos, privately on your device.</Text>

          <Text style={styles.sectionLabel}>Choose what to scan</Text>
          <Pressable style={[styles.sourceCard, source === 'Entire library' && styles.sourceActive]} onPress={() => setSource('Entire library')}>
            <View style={styles.sourceIcon}><Text>▦</Text></View><View style={styles.sourceText}><Text style={styles.sourceTitle}>Entire library</Text><Text style={styles.sourceDetail}>Photos and videos on this device</Text></View><Text style={styles.radio}>{source === 'Entire library' ? '●' : '○'}</Text>
          </Pressable>
          <Pressable style={[styles.sourceCard, source === 'Choose a folder' && styles.sourceActive]} onPress={() => setSource('Choose a folder')}>
            <View style={styles.sourceIcon}><Text>□</Text></View><View style={styles.sourceText}><Text style={styles.sourceTitle}>Choose a folder</Text><Text style={styles.sourceDetail}>Scan a specific album or folder</Text></View><Text style={styles.radio}>{source === 'Choose a folder' ? '●' : '○'}</Text>
          </Pressable>

          <View style={styles.privacy}><Text style={styles.privacyIcon}>✓</Text><View><Text style={styles.privacyTitle}>100% private</Text><Text style={styles.privacyCopy}>Your files never leave your device.</Text></View></View>
          <Pressable style={styles.primaryButton} onPress={startScan}><Text style={styles.primaryButtonText}>Scan {source.toLowerCase()}  →</Text></Pressable>
          <Text style={styles.version}>MediaWizard prototype · Local processing</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'results') {
    const scanning = scanProgress < 100;
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.topBar}><Pressable onPress={() => setScreen('home')}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.topTitle}>Scan results</Text>{scanning ? <Text style={styles.topMeta}>{scanProgress}%</Text> : null}</View>
          {scanning ? <View style={styles.scanBox}><Text style={styles.scanTitle}>Looking through your library…</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${scanProgress}%` }]} /></View><Text style={styles.scanDetail}>Checking photos, videos and file sizes</Text></View> : null}
          {!scanning ? <>
            <Text style={styles.resultHeadline}>We found some easy wins.</Text>
            <Text style={styles.resultCopy}>Review the groups below. We’ll always keep your best original.</Text>
            <View style={styles.statRow}><View style={styles.stat}><Text style={styles.statNumber}>2</Text><Text style={styles.statLabel}>Photo groups</Text></View><View style={styles.stat}><Text style={styles.statNumber}>1</Text><Text style={styles.statLabel}>Video group</Text></View><View style={styles.stat}><Text style={styles.statNumber}>2.2 GB</Text><Text style={styles.statLabel}>Potential saved</Text></View></View>
            <View style={styles.tabs}>{(['Photos', 'Videos', 'Large files'] as ResultTab[]).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</View>
            {tab === 'Photos' ? <><Text style={styles.groupHeading}>Duplicate photos <Text style={styles.groupCount}>· 2 groups</Text></Text>{duplicatePhotos.map((item) => renderResultCard(item))}</> : null}
            {tab === 'Videos' ? <><Text style={styles.groupHeading}>Duplicate videos <Text style={styles.groupCount}>· 1 group</Text></Text>{duplicateVideos.map((item) => renderResultCard(item))}</> : null}
            {tab === 'Large files' ? <><Text style={styles.groupHeading}>Large videos <Text style={styles.groupCount}>· 3 files</Text></Text><Pressable style={styles.selectAllRow} onPress={() => setSelectedLarge(selectedLarge.length === largeVideos.length ? [] : largeVideos.map((item) => item.id))}><View><Text style={styles.selectAllTitle}>Select all</Text><Text style={styles.selectAllDetail}>{selectedLarge.length} of {largeVideos.length} selected</Text></View><View style={[styles.checkbox, selectedLarge.length === largeVideos.length && styles.checkboxChecked]}><Text style={styles.check}>{selectedLarge.length === largeVideos.length ? '✓' : ''}</Text></View></Pressable><Text style={styles.selectionHint}>Tap a video to select or deselect it</Text>{largeVideos.map((item) => renderResultCard(item, true))}<Pressable style={styles.primaryButton} onPress={() => setScreen('cleanup')}><Text style={styles.primaryButtonText}>Compress {selectedLarge.length} videos  →</Text></Pressable></> : null}
            {tab !== 'Large files' ? <Pressable style={styles.dangerButton} onPress={() => setScreen('done')}><Text style={styles.dangerButtonText}>Delete all duplicates</Text><Text style={styles.dangerDetail}>Keep the best copy automatically</Text></Pressable> : null}
          </> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'cleanup') {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}><Pressable onPress={() => setScreen('results')}><Text style={styles.back}>‹</Text></Pressable><Text style={styles.topTitle}>Compress videos</Text><Text style={styles.topMeta}>{selectedLarge.length} selected</Text></View>
        <Text style={styles.resultHeadline}>Save {Math.round(selectedSavings)} MB</Text><Text style={styles.resultCopy}>MediaWizard will use your device’s efficient video encoder and process one file at a time.</Text>
        <Text style={styles.groupHeading}>Selected videos</Text>{largeVideos.filter((item) => selectedLarge.includes(item.id)).map((item) => renderResultCard(item, true))}
        <View style={styles.optionBlock}><Text style={styles.optionTitle}>After compression</Text><Pressable style={styles.optionRow} onPress={() => setKeepOriginals(true)}><Text style={styles.optionText}>Keep original files</Text><Text style={styles.radio}>{keepOriginals ? '●' : '○'}</Text></Pressable><Pressable style={styles.optionRow} onPress={() => setKeepOriginals(false)}><Text style={styles.optionText}>Delete originals after verifying</Text><Text style={styles.radio}>{!keepOriginals ? '●' : '○'}</Text></Pressable></View>
        <View style={styles.thermalNote}><Text style={styles.privacyIcon}>◌</Text><Text style={styles.privacyCopy}>Processing pauses automatically if your phone gets hot or the battery is low.</Text></View>
        <Pressable style={styles.primaryButton} onPress={() => setScreen('done')}><Text style={styles.primaryButtonText}>Start compression  →</Text></Pressable>
      </ScrollView></SafeAreaView>
    );
  }

  return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}><StatusBar style="dark" /><View style={[styles.container, styles.doneContainer]}><View style={styles.doneIcon}>✓</View><Text style={styles.heroTitle}>All done.</Text><Text style={styles.heroCopy}>Your library is a little lighter and a lot tidier.</Text><View style={styles.savedCard}><Text style={styles.savedLabel}>STORAGE SAVED</Text><Text style={styles.savedValue}>{Math.round(selectedSavings + 194)} MB</Text><Text style={styles.savedDetail}>Duplicates removed and videos compressed</Text></View><Pressable style={styles.primaryButton} onPress={() => setScreen('home')}><Text style={styles.primaryButtonText}>Back to home</Text></Pressable></View></SafeAreaView>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
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
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 }, back: { color: '#183C38', fontSize: 36, lineHeight: 30, marginRight: 12 }, topTitle: { flex: 1, color: '#183C38', fontSize: 19, fontWeight: '700' }, topMeta: { color: '#8B9992', fontSize: 13 },
  scanBox: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20, marginTop: 20 }, scanTitle: { color: '#183C38', fontWeight: '700', fontSize: 16 }, progressTrack: { height: 7, borderRadius: 4, backgroundColor: '#E5EBE1', overflow: 'hidden', marginTop: 20 }, progressFill: { height: '100%', backgroundColor: '#B8CA55' }, scanDetail: { color: '#8B9992', fontSize: 12, marginTop: 10 },
  resultHeadline: { color: '#183C38', fontSize: 27, fontWeight: '700', letterSpacing: -0.7 }, resultCopy: { color: '#71807B', lineHeight: 21, fontSize: 14, marginTop: 8 }, statRow: { flexDirection: 'row', gap: 8, marginTop: 24 }, stat: { flex: 1, backgroundColor: '#E9F0DF', borderRadius: 14, padding: 13 }, statNumber: { color: '#183C38', fontSize: 19, fontWeight: '700' }, statLabel: { color: '#738276', fontSize: 10, marginTop: 5 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E1E8E1', marginTop: 32, marginBottom: 22 }, tab: { paddingBottom: 12, marginRight: 22 }, tabActive: { borderBottomWidth: 2, borderBottomColor: '#9AAF43' }, tabText: { color: '#9AA59F', fontSize: 13, fontWeight: '700' }, tabTextActive: { color: '#183C38' },
  groupHeading: { color: '#183C38', fontSize: 17, fontWeight: '700', marginBottom: 12 }, groupCount: { color: '#9AA59F', fontSize: 13, fontWeight: '400' }, selectionHint: { color: '#8A9891', fontSize: 12, marginTop: -5, marginBottom: 14 },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#EEF3E5', borderRadius: 14, padding: 14, marginBottom: 12 },
  selectAllTitle: { color: '#183C38', fontSize: 14, fontWeight: '700' }, selectAllDetail: { color: '#7D8C82', fontSize: 11, marginTop: 4 },
  mediaCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 10, marginBottom: 9, borderWidth: 1, borderColor: '#ECF0EB' }, mediaCardSelected: { borderColor: '#B8CA55', backgroundColor: '#FCFFF4' }, thumbnail: { width: 50, height: 50, borderRadius: 11, backgroundColor: '#DDE8D3', alignItems: 'center', justifyContent: 'center' }, thumbnailIcon: { color: '#658052', fontSize: 20 }, mediaInfo: { flex: 1, marginLeft: 12 }, mediaName: { color: '#29463F', fontSize: 14, fontWeight: '700' }, mediaDetail: { color: '#8B9992', fontSize: 11, marginTop: 5 }, checkbox: { width: 23, height: 23, borderRadius: 7, borderWidth: 1.5, borderColor: '#C6D0C7', alignItems: 'center', justifyContent: 'center' }, checkboxChecked: { backgroundColor: '#9AAF43', borderColor: '#9AAF43' }, check: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  dangerButton: { backgroundColor: '#FCEFEA', borderRadius: 16, padding: 17, alignItems: 'center', marginTop: 20 }, dangerButtonText: { color: '#B55F4E', fontWeight: '700', fontSize: 14 }, dangerDetail: { color: '#C58A7D', fontSize: 11, marginTop: 5 },
  optionBlock: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginTop: 24 }, optionTitle: { color: '#183C38', fontSize: 14, fontWeight: '700', marginBottom: 4 }, optionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 13, borderTopWidth: 1, borderTopColor: '#F0F2EE' }, optionText: { color: '#52635C', fontSize: 14 }, thermalNote: { flexDirection: 'row', gap: 10, backgroundColor: '#EEF3E5', padding: 14, borderRadius: 14, marginTop: 16 }, doneContainer: { flex: 1, justifyContent: 'center' }, doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#DDEBC2', alignItems: 'center', justifyContent: 'center', color: '#69863B', fontSize: 34, marginBottom: 24 }, savedCard: { backgroundColor: '#183C38', borderRadius: 20, padding: 24, marginTop: 32 }, savedLabel: { color: '#B8CA55', fontSize: 11, letterSpacing: 1.5, fontWeight: '700' }, savedValue: { color: '#FFFFFF', fontSize: 42, fontWeight: '700', marginTop: 8 }, savedDetail: { color: '#B5C5BE', fontSize: 13, marginTop: 4 },
});
