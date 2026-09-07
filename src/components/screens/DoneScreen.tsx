import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '../styles/mediaWizardStyles';

export function DoneScreen({
  selectedSavings,
  onHome,
}: {
  selectedSavings: number;
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
            {Math.round(selectedSavings + 194)} MB
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