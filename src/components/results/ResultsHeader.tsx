import { Pressable, Text, View } from 'react-native';
import type { ScanState } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';

export function ResultsHeader({
  scanState,
  scanProgress,
  onBack,
  onFinish,
}: {
  scanState: ScanState;
  scanProgress: number;
  onBack: () => void;
  /** When provided, a "Done" button is shown in the header. */
  onFinish?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹</Text>
      </Pressable>
      <Text style={styles.topTitle}>Scan results</Text>
      {scanState === 'scanning' ? (
        <Text style={styles.topMeta}>{scanProgress}%</Text>
      ) : onFinish ? (
        <Pressable style={styles.finishButton} onPress={onFinish} hitSlop={8}>
          <Text style={styles.finishButtonText}>Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
