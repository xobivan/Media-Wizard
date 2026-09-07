import { Pressable, Text, View } from 'react-native';
import { MediaCard } from '../MediaCard';
import { duplicatePhotos, duplicateVideos, largeVideos } from '../data/mediaWizardData';
import type { ResultTab } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';

type SectionProps = { selectedLarge: string[]; onToggleLarge: (id: string) => void; onSelectAll: () => void; onContinue: () => void };

export function ResultsSections({ tab, ...props }: SectionProps & { tab: ResultTab }) {
  if (tab === 'Photos') return <DuplicatePhotos />;
  if (tab === 'Videos') return <DuplicateVideos />;
  return <LargeVideos {...props} />;
}

function DuplicatePhotos() {
  return (
    <>
      <Text style={styles.groupHeading}>
        Duplicate photos
      </Text>

      {duplicatePhotos.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          onPress={() => undefined}
        />
      ))}
    </>
  );
}

function DuplicateVideos() {
  return (
    <>
      <Text style={styles.groupHeading}>
        Duplicate videos
      </Text>

      {duplicateVideos.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          onPress={() => undefined}
        />
      ))}
    </>
  );
}

function LargeVideos({
  selectedLarge,
  onToggleLarge,
  onSelectAll,
  onContinue,
}: SectionProps) {
  const allSelected =
    selectedLarge.length === largeVideos.length;

  return (
    <>
      <Text style={styles.groupHeading}>
        Large videos
      </Text>

      <SelectAllRow
        selectedCount={selectedLarge.length}
        totalCount={largeVideos.length}
        allSelected={allSelected}
        onPress={onSelectAll}
      />

      <Text style={styles.selectionHint}>
        Tap a video to select or deselect it
      </Text>

      {largeVideos.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          selectable
          selected={selectedLarge.includes(item.id)}
          onPress={() => onToggleLarge(item.id)}
        />
      ))}

      <Pressable
        style={styles.primaryButton}
        onPress={onContinue}
      >
        <Text style={styles.primaryButtonText}>
          Continue to cleanup →
        </Text>
      </Pressable>
    </>
  );
}

function SelectAllRow({
  selectedCount,
  totalCount,
  allSelected,
  onPress,
}: {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.selectAllRow}
      onPress={onPress}
    >
      <View>
        <Text style={styles.selectAllTitle}>
          Select all
        </Text>

        <Text style={styles.selectAllDetail}>
          {selectedCount} of {totalCount} selected
        </Text>
      </View>

      <View
        style={[
          styles.checkbox,
          allSelected && styles.checkboxChecked,
        ]}
      >
        <Text style={styles.check}>
          {allSelected ? '✓' : ''}
        </Text>
      </View>
    </Pressable>
  );
}

