import { Text, View } from 'react-native';
import type { ScanSummary } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';

export function ResultsSummary({
  summary,
  albumTitle,
}: {
  summary: ScanSummary;
  albumTitle?: string;
}) {
  return (
    <>
      <Text style={styles.resultHeadline}>
        Library scan complete.
      </Text>

      <Text style={styles.resultCopy}>
        We found {summary.total} media items in{' '}
        {albumTitle ?? 'your library'}.
      </Text>

      <View style={styles.statRow}>
        <Stat
          value={summary.photos}
          label="Photos"
        />

        <Stat
          value={summary.videos}
          label="Videos"
        />

        <Stat
          value={summary.total}
          label="Total items"
        />
      </View>
    </>
  );
}

function Stat({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNumber}>
        {value}
      </Text>

      <Text style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}