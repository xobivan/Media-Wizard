import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { MediaCard } from '../MediaCard';
import type { LargeVideo, ResultTab } from '../types/mediaWizardTypes';
import type { DuplicateGroup } from '../../services/duplicateDetection';
import { styles } from '../styles/mediaWizardStyles';

type SectionProps = { duplicateGroups: DuplicateGroup[]; largeVideos: LargeVideo[]; selectedLarge: string[]; onToggleLarge: (id: string) => void; onSelectAll: () => void; onContinue: () => void; onDeleteDuplicateGroup: (group: DuplicateGroup) => void; onDeleteAllDuplicateGroups: (groups: DuplicateGroup[]) => void };

export function ResultsSections({ tab, ...props }: SectionProps & { tab: ResultTab }) {
  if (tab === 'Photos') return <DuplicatePhotos groups={props.duplicateGroups.filter((group) => group.mediaType === 'photo')} onDeleteGroup={props.onDeleteDuplicateGroup} onDeleteAllGroups={props.onDeleteAllDuplicateGroups} />;
  if (tab === 'Videos') return <DuplicateVideos groups={props.duplicateGroups.filter((group) => group.mediaType === 'video')} onDeleteGroup={props.onDeleteDuplicateGroup} onDeleteAllGroups={props.onDeleteAllDuplicateGroups} />;
  return <LargeVideos {...props} />;
}

function DuplicatePhotos({ groups, onDeleteGroup, onDeleteAllGroups }: { groups: DuplicateGroup[]; onDeleteGroup: (group: DuplicateGroup) => void; onDeleteAllGroups: (groups: DuplicateGroup[]) => void }) {
  return (
    <>
      <Text style={styles.groupHeading}>
        Duplicate photos
      </Text>

      {groups.length === 0 ? <Text style={styles.selectionHint}>No exact duplicate photos found.</Text> : <>{groups.map((group) => <DuplicateGroupCard key={group.assets[0].fingerprint} group={group} onDelete={() => onDeleteGroup(group)} />)}<DeleteAllButton groups={groups} onPress={() => onDeleteAllGroups(groups)} /></>}
    </>
  );
}

function DuplicateVideos({ groups, onDeleteGroup, onDeleteAllGroups }: { groups: DuplicateGroup[]; onDeleteGroup: (group: DuplicateGroup) => void; onDeleteAllGroups: (groups: DuplicateGroup[]) => void }) {
  return (
    <>
      <Text style={styles.groupHeading}>
        Duplicate videos
      </Text>

      {groups.length === 0 ? <Text style={styles.selectionHint}>No exact duplicate videos found.</Text> : <>{groups.map((group) => <DuplicateGroupCard key={group.assets[0].fingerprint} group={group} onDelete={() => onDeleteGroup(group)} />)}<DeleteAllButton groups={groups} onPress={() => onDeleteAllGroups(groups)} /></>}
    </>
  );
}

function DeleteAllButton({ groups, onPress }: { groups: DuplicateGroup[]; onPress: () => void }) {
  const duplicateCount = groups.reduce((total, group) => total + group.assets.length - 1, 0);
  return (
    <Pressable style={styles.deleteAllButton} onPress={onPress}>
      <Text style={styles.deleteButtonText}>Delete all {duplicateCount} duplicates</Text>
    </Pressable>
  );
}

function DuplicateGroupCard({ group, onDelete }: { group: DuplicateGroup; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const original = group.assets.reduce((oldest, asset) => asset.creationTime < oldest.creationTime ? asset : oldest, group.assets[0]);
  const duplicateCount = group.assets.length - 1;

  return (
    <View style={styles.duplicateGroup}>
      <Pressable style={styles.duplicateGroupHeader} onPress={() => setExpanded((value) => !value)}>
        <View style={styles.mediaInfo}>
          <Text style={styles.mediaName}>{original.filename}</Text>
          <Text style={styles.mediaDetail}>{group.assets.length} copies · {formatBytes(original.size)} each</Text>
        </View>
        <Text style={styles.duplicateGroupChevron}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.duplicateGroupDetails}>
          <Text style={styles.duplicateOriginal}>Original kept: {original.filename}</Text>
          {group.assets.map((asset) => (
            <View key={asset.id} style={styles.duplicateAssetRow}>
              {group.mediaType === 'photo' ? (
                <Image source={{ uri: asset.uri }} style={styles.duplicatePreview} resizeMode="cover" />
              ) : (
                <View style={styles.duplicatePreviewPlaceholder}>
                  <Text style={styles.thumbnailIcon}>▶</Text>
                </View>
              )}
              <View style={styles.duplicateAssetInfo}>
                <Text style={styles.duplicateAsset}>
                  {asset.id === original.id ? 'Original kept' : 'Will be deleted'}
                </Text>
                <Text style={styles.duplicateAssetName}>{asset.filename}</Text>
              </View>
            </View>
          ))}
          <Pressable style={styles.deleteButton} onPress={onDelete}>
            <Text style={styles.deleteButtonText}>Delete {duplicateCount} duplicates</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LargeVideos({
  largeVideos,
  selectedLarge,
  onToggleLarge,
  onSelectAll,
  onContinue,
}: SectionProps) {
  const hasLargeVideos = largeVideos.length > 0;
  const allSelected =
    hasLargeVideos && selectedLarge.length === largeVideos.length;

  if (!hasLargeVideos) {
    return (
      <View style={styles.noLargeFilesCard}>
        <Text style={styles.noLargeFilesTitle}>
          No large videos found
        </Text>

        <Text style={styles.noLargeFilesDetail}>
          There are no videos larger than 200 MB in this scan.
        </Text>
      </View>
    );
  }

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
          Continue to cleanup
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
