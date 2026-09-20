import { Pressable, Text, View } from 'react-native';
import type { ResultTab, ScanTarget } from '../types/mediaWizardTypes';
import { styles } from '../styles/mediaWizardStyles';

export function ResultsTabs({
  value,
  onChange,
  scanTargets,
}: {
  value: ResultTab;
  onChange: (tab: ResultTab) => void;
  scanTargets: ScanTarget[];
}) {
  const tabs: ResultTab[] = [
    ...(scanTargets.includes('photoDuplicates') ? ['Photos' as const] : []),
    ...(scanTargets.includes('videoDuplicates') ? ['Videos' as const] : []),
    ...(scanTargets.includes('largeVideos') ? ['Large files' as const] : []),
  ];
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
