import { Text, View } from 'react-native';
import type { ScanSummary, ScanTarget } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';

export function ResultsSummary({
  summary,
  albumTitle,
  estimatedSavings,
  scanTargets,
}: {
  summary: ScanSummary;
  albumTitle?: string;
  estimatedSavings: number;
  scanTargets: ScanTarget[];
}) {
  const showsPhotos = scanTargets.includes('photoDuplicates');
  const showsVideos = scanTargets.includes('videoDuplicates') || scanTargets.includes('largeVideos');
  return (
    <>
      <Text style={styles.resultHeadline}>
        Library scan complete.
      </Text>

      <Text style={styles.resultCopy}>
        We found {summary.total} media items in{' '}
        {albumTitle ?? 'your library'}.
      </Text>
      <Text style={styles.savingsEstimate}>Up to {formatBytes(estimatedSavings)} could be saved after cleaning.</Text>

      <View style={styles.statRow}>
        {showsPhotos ? <Stat value={summary.photos} label="Photos" /> : null}

        {showsVideos ? <Stat value={summary.videos} label="Videos" /> : null}

        <Stat
          value={summary.total}
          label="Total items"
        />
      </View>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
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
