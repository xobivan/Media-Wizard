import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MediaCard } from '../MediaCard';
import type { LargeVideo } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';
import type { CompressionQuality } from '../../services/smartCompression';

export function CleanupScreen({
  largeVideos,
  selectedLarge,
  selectedSavings,
  keepOriginals,
  onBack,
  onKeepOriginalsChange,
  onDone,
  compressionProgress,
  compressionCurrent,
  compressionState,
  compressionError,
  onCancelCompression,
  onStartCompression,
  compressionQuality,
  onCompressionQualityChange,
}: {
  largeVideos: LargeVideo[];
  selectedLarge: string[];
  selectedSavings: number;
  keepOriginals: boolean;
  onBack: () => void;
  onKeepOriginalsChange: (keep: boolean) => void;
  onDone: () => void;
  compressionProgress: number;
  compressionCurrent: number;
  compressionState: 'idle' | 'compressing' | 'complete' | 'error';
  compressionError: string | null;
  onCancelCompression: () => void;
  onStartCompression: () => void;
  compressionQuality: CompressionQuality;
  onCompressionQualityChange: (quality: CompressionQuality) => void;
}) {
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={styles.safe}
    >
      <StatusBar style="dark" />

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Pressable onPress={onBack}>
            <Text style={styles.back}>‹</Text>
          </Pressable>

          <Text style={styles.topTitle}>Compress videos</Text>

          <Text style={styles.topMeta}>
            {selectedLarge.length} selected
          </Text>
        </View>

        <Text style={styles.resultHeadline}>
          Save {Math.round(selectedSavings)} MB
        </Text>

        <Text style={styles.resultCopy}>
          MediaWizard will use your device’s efficient video encoder and
          process one file at a time.
        </Text>

        <Text style={styles.groupHeading}>Selected videos</Text>

        {largeVideos
          .filter((item) => selectedLarge.includes(item.id))
          .map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              selected
              onPress={() => undefined}
            />
          ))}

        <View style={styles.optionBlock}>
          <Text style={styles.optionTitle}>Compression quality</Text>
          {(['balanced', 'high', 'maximum_savings'] as CompressionQuality[]).map((quality) => (
            <Pressable key={quality} style={styles.optionRow} onPress={() => onCompressionQualityChange(quality)}>
              <Text style={styles.optionText}>
                {quality === 'balanced' ? 'Balanced' : quality === 'high' ? 'High quality' : 'Maximum savings'}
              </Text>
              <Text style={styles.radio}>{compressionQuality === quality ? '●' : '○'}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.optionBlock}>
          <Text style={styles.optionTitle}>After compression</Text>

          <Pressable
            style={styles.optionRow}
            onPress={() => onKeepOriginalsChange(true)}
          >
            <Text style={styles.optionText}>Keep original files</Text>

            <Text style={styles.radio}>
              {keepOriginals ? '●' : '○'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.optionRow}
            onPress={() => onKeepOriginalsChange(false)}
          >
            <Text style={styles.optionText}>
              Delete originals after verifying
            </Text>

            <Text style={styles.radio}>
              {!keepOriginals ? '●' : '○'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.thermalNote}>
          <Text style={styles.privacyIcon}>◌</Text>

          <Text style={styles.privacyCopy}>
            Processing pauses automatically if your phone gets hot or the
            battery is low.
          </Text>
        </View>

        {compressionState === 'compressing' ? (
          <View>
            <Text style={styles.resultCopy}>Compressing {compressionCurrent} of {selectedLarge.length} · {compressionProgress}%</Text>
            <Pressable style={styles.secondaryButton} onPress={onCancelCompression}>
              <Text style={styles.secondaryButtonText}>Cancel compression</Text>
            </Pressable>
          </View>
        ) : compressionState === 'complete' ? (
          <Pressable style={styles.primaryButton} onPress={onDone}>
            <Text style={styles.primaryButtonText}>View results  →</Text>
          </Pressable>
        ) : (
        <Pressable
          style={styles.primaryButton}
          onPress={onStartCompression}
        >
          <Text style={styles.primaryButtonText}>
            Start compression  →
          </Text>
        </Pressable>
        )}
        {compressionState === 'error' && compressionError ? <Text style={styles.errorText}>{compressionError}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}