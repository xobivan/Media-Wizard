import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '../styles/mediaWizardStyles';

export function DoneScreen({
  selectedSavings,
  duplicateStorageSaved,
  onHome,
}: {
  selectedSavings: number;
  duplicateStorageSaved: number;
  onHome: () => void;
}) {
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={styles.safe}
    >
      <StatusBar style="dark" />

      <View
        style={[
          styles.container,
          styles.doneContainer,
        ]}
      >
        <View style={styles.doneIcon}>
          <Text style={styles.doneIconText}>
            ✓
          </Text>
        </View>

        <Text style={styles.heroTitle}>
          All done.
        </Text>

        <Text style={styles.heroCopy}>
          Your library is a little lighter and a lot tidier.
        </Text>

        <View style={styles.savedCard}>
          <Text style={styles.savedLabel}>
            STORAGE SAVED
          </Text>

          <Text style={styles.savedValue}>
            {formatStorageSaved(selectedSavings, duplicateStorageSaved)}
          </Text>

          <Text style={styles.savedDetail}>
            Duplicates removed and videos compressed
          </Text>
        </View>

        <Pressable
          style={styles.primaryButton}
          onPress={onHome}
        >
          <Text style={styles.primaryButtonText}>
            Back to home
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function formatStorageSaved(compressedMegabytes: number, duplicateBytes: number): string {
  const totalMegabytes = compressedMegabytes + duplicateBytes / (1024 * 1024);
  if (totalMegabytes >= 1024) return `${(totalMegabytes / 1024).toFixed(2)} GB`;
  return `${Math.round(totalMegabytes)} MB`;
}