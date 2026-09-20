import { Pressable, Text, View } from 'react-native';
import type { MediaItem } from './types/mediaWizardTypes';
import { styles } from './styles/mediaWizardStyles';

export function MediaCard({
  item,
  selected,
  selectable,
  onPress,
}: {
  item: MediaItem;
  selected?: boolean;
  selectable?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.mediaCard,
        selectable && selected && styles.mediaCardSelected,
      ]}
      onPress={onPress}
    >
      <View style={styles.thumbnail}>
        <Text style={styles.thumbnailIcon}>
          {selectable ? '▶' : '▧'}
        </Text>
      </View>

      <View style={styles.mediaInfo}>
        <Text style={styles.mediaName}>{item.name}</Text>
        <Text style={styles.mediaDetail}>{item.detail}</Text>
      </View>

      {selectable ? (
        <View
          style={[
            styles.checkbox,
            selected && styles.checkboxChecked,
          ]}
        >
          <Text style={styles.check}>
            {selected ? '✓' : ''}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
