import { StatusBar } from 'expo-status-bar';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ALL_SCAN_TARGETS, type Album, type PermissionState, type ScanMode, type ScanState, type ScanTarget } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';

type Props = {
  source: string;
  permission: PermissionState;
  scanState: ScanState;
  selectedAlbum: Album | null;
  albums: Album[];
  albumPickerVisible: boolean;
  onSelectLibrary: () => void;
  onChooseFolder: () => void;
  onSelectAlbum: (album: Album) => void;
  onRequestPermission: () => void;
  onStartScan: () => void;
  scanMode: ScanMode;
  onScanModeChange: (mode: ScanMode) => void;
  scanTargets: ScanTarget[];
  onScanTargetsChange: (targets: ScanTarget[]) => void;
};

export function HomeScreen({
  source,
  permission,
  scanState,
  selectedAlbum,
  albums,
  albumPickerVisible,
  onSelectLibrary,
  onChooseFolder,
  onSelectAlbum,
  onRequestPermission,
  onStartScan,
  scanMode,
  onScanModeChange,
  scanTargets,
  onScanTargetsChange,
}: Props) {
  const toggleTarget = (target: ScanTarget) => {
    const next = scanTargets.includes(target)
      ? scanTargets.filter((item) => item !== target)
      : [...scanTargets, target];
    onScanTargetsChange(next);
  };
  const allSelected = scanTargets.length === ALL_SCAN_TARGETS.length;
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={styles.safe}
    >
      <StatusBar style="dark" />

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>
              ✦
            </Text>
          </View>

          <Text style={styles.brand}>
            MediaWizard
          </Text>
        </View>

        <Text style={styles.eyebrow}>
          SMART STORAGE CLEANUP
        </Text>

        <Text style={styles.heroTitle}>
          Make room for what matters.
        </Text>

        <Text style={styles.heroCopy}>
          Find duplicates and shrink large videos,
          privately on your device.
        </Text>

        <Text style={styles.sectionLabel}>
          Choose what to scan
        </Text>

        <Pressable
          style={[
            styles.sourceCard,
            source === 'Entire library' &&
              styles.sourceActive,
          ]}
          onPress={onSelectLibrary}
        >
          <View style={styles.sourceIcon}>
            <Text>▦</Text>
          </View>

          <View style={styles.sourceText}>
            <Text style={styles.sourceTitle}>
              Entire library
            </Text>

            <Text style={styles.sourceDetail}>
              Photos and videos on this device
            </Text>
          </View>

          <Text style={styles.radio}>
            {source === 'Entire library' ? '●' : '○'}
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.sourceCard,
            source === 'Choose a folder' &&
              styles.sourceActive,
          ]}
          onPress={onChooseFolder}
        >
          <View style={styles.sourceIcon}>
            <Text>□</Text>
          </View>

          <View style={styles.sourceText}>
            <Text style={styles.sourceTitle}>
              {selectedAlbum?.title ?? 'Choose a folder'}
            </Text>

            <Text style={styles.sourceDetail}>
              {selectedAlbum
                ? `${selectedAlbum.assetCount} media items`
                : 'Choose a device album'}
            </Text>
          </View>

          <Text style={styles.radio}>
            {source === 'Choose a folder' ? '●' : '○'}
          </Text>
        </Pressable>

        {albumPickerVisible ? (
          <View style={styles.albumPicker}>
            <Text style={styles.permissionTitle}>
              Choose an album
            </Text>

            {albums.length === 0 ? (
              <Text style={styles.permissionDetail}>
                No albums with media were found.
              </Text>
            ) : (
              albums.map((album) => (
                <Pressable
                  key={album.id}
                  style={styles.albumRow}
                  onPress={() => onSelectAlbum(album)}
                >
                  <Text style={styles.optionText}>
                    {album.title}
                  </Text>

                  <Text style={styles.permissionDetail}>
                    {album.assetCount} items
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Choose scan depth</Text>
        <ScanModeOption mode="fast" selected={scanMode === 'fast'} onPress={() => onScanModeChange('fast')} title="Fast scan" detail="Uses exact file matching and finishes sooner." />
        <ScanModeOption mode="deep" selected={scanMode === 'deep'} onPress={() => onScanModeChange('deep')} title="Deep scan" detail="Normalizes photos to find more duplicates, but may take much longer." />

        <Text style={styles.sectionLabel}>Choose what to find</Text>
        <ScanTargetOption selected={allSelected} onPress={() => onScanTargetsChange(allSelected ? scanTargets : ALL_SCAN_TARGETS)} title="All" detail="Photos, videos, and large videos." />
        <ScanTargetOption selected={scanTargets.includes('videoDuplicates')} onPress={() => toggleTarget('videoDuplicates')} title="Video duplicates" detail="Find matching video files." />
        <ScanTargetOption selected={scanTargets.includes('photoDuplicates')} onPress={() => toggleTarget('photoDuplicates')} title="Picture duplicates" detail="Find matching photo files." />
        <ScanTargetOption selected={scanTargets.includes('largeVideos')} onPress={() => toggleTarget('largeVideos')} title="Large videos" detail="Find videos over 200 MB to compress." />

        <View style={styles.privacy}>
          <Text style={styles.privacyIcon}>
            ✓
          </Text>

          <View>
            <Text style={styles.privacyTitle}>
              100% private
            </Text>

            <Text style={styles.privacyCopy}>
              Your files never leave your device.
            </Text>
          </View>
        </View>

        {permission === 'checking' ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>
              Checking media access…
            </Text>
          </View>
        ) : null}

        {permission === 'granted' ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionIcon}>
              ✓
            </Text>

            <View>
              <Text style={styles.permissionTitle}>
                Media access granted
              </Text>

              <Text style={styles.permissionDetail}>
                MediaWizard can scan your library.
              </Text>
            </View>
          </View>
        ) : null}

        {permission === 'limited' ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionIcon}>
              !
            </Text>

            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>
                Limited media access
              </Text>

              <Text style={styles.permissionDetail}>
                Only selected photos and videos are
                available.
              </Text>
            </View>

            <Pressable onPress={onRequestPermission}>
              <Text style={styles.permissionAction}>
                Change
              </Text>
            </Pressable>
          </View>
        ) : null}

        {permission === 'denied' ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionIcon}>
              !
            </Text>

            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>
                Media access is needed
              </Text>

              <Text style={styles.permissionDetail}>
                Allow access to scan this device.
              </Text>
            </View>

            <Pressable onPress={() => void Linking.openSettings()}>
              <Text style={styles.permissionAction}>
                Allow
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          style={[
            styles.primaryButton,
            (
              permission === 'checking' ||
              permission === 'denied' ||
              scanState === 'scanning' ||
              scanTargets.length === 0
            ) &&
              styles.primaryButtonDisabled,
          ]}
          disabled={
            permission === 'checking' ||
            permission === 'denied' ||
            scanState === 'scanning' ||
            scanTargets.length === 0
          }
          onPress={onStartScan}
        >
          <Text style={styles.primaryButtonText}>
            {scanTargets.length === 0 ? 'Choose what to scan' : `Scan ${source.toLowerCase()} →`}
          </Text>
        </Pressable>

        <Text style={styles.version}>
          MediaWizard prototype · Local processing
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ScanModeOption({ mode: _mode, selected, onPress, title, detail }: { mode: ScanMode; selected: boolean; onPress: () => void; title: string; detail: string }) {
  return (
    <Pressable style={[styles.sourceCard, selected && styles.sourceActive]} onPress={onPress}>
      <View style={styles.sourceText}>
        <Text style={styles.sourceTitle}>{title}</Text>
        <Text style={styles.sourceDetail}>{detail}</Text>
      </View>
      <Text style={styles.radio}>{selected ? '●' : '○'}</Text>
    </Pressable>
  );
}

function ScanTargetOption({ selected, onPress, title, detail }: { selected: boolean; onPress: () => void; title: string; detail: string }) {
  return (
    <Pressable style={[styles.sourceCard, selected && styles.sourceActive]} onPress={onPress}>
      <View style={styles.sourceText}>
        <Text style={styles.sourceTitle}>{title}</Text>
        <Text style={styles.sourceDetail}>{detail}</Text>
      </View>
      <Text style={styles.radio}>{selected ? '●' : '○'}</Text>
    </Pressable>
  );
}
