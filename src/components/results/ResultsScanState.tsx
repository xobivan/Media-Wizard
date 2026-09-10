import { Pressable, Text, View } from 'react-native';
import type { Album } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';

export function ResultsScanState({ progress, album, onAbort }: { progress: number; album: Album | null; onAbort: () => void }) {
  return (
    <View style={styles.scanBox}>
      <Text style={styles.scanTitle}>Looking through your library…</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
        <Text style={styles.scanDetail}>Reading media metadata from {album?.title ?? 'your library'}</Text>
        <Text style={styles.scanExplanation}>
          Large libraries and large videos can take extra time while MediaWizard verifies file contents. You can leave this screen open while the scan continues.
        </Text>
        <Pressable style={styles.abortButton} onPress={onAbort}>
          <Text style={styles.abortButtonText}>Abort scan</Text>
        </Pressable>
    </View>
  );
}

export function ResultsErrorState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <View style={styles.errorCard}>
      <Text style={styles.errorTitle}>Scan could not finish</Text>
      <Text style={styles.errorDetail}>{error}</Text>
      <Pressable onPress={onRetry}>
        <Text style={styles.permissionAction}>Try again</Text>
      </Pressable>
    </View>
  );
}
