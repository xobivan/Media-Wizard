import { Pressable, Text, View } from 'react-native';
import type { ResultTab } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';

const tabs: ResultTab[] = ['Photos', 'Videos', 'Large files'];

export function ResultsTabs({
  value,
  onChange,
}: {
  value: ResultTab;
  onChange: (tab: ResultTab) => void;
}) {
  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => (
        <Pressable
          key={tab}
          onPress={() => onChange(tab)}
          style={[
            styles.tab,
            value === tab && styles.tabActive,
          ]}
        >
          <Text
            style={[
              styles.tabText,
              value === tab && styles.tabTextActive,
            ]}
          >
            {tab}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}