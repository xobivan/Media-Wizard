import { StatusBar } from 'expo-status-bar';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ResultsHeader } from '../results/ResultsHeader';
import { ResultsScanState, ResultsErrorState } from '../results/ResultsScanState';
import { ResultsSummary } from '../results/ResultsSummary';
import { ResultsTabs } from '../results/ResultsTabs';
import { ResultsSections } from '../results/ResultsSections';
import type { Album, LargeVideo, ResultTab, ScanState, ScanSummary } from '../types/mediaWizardTypes';
import type { DuplicateGroup } from '../../services/duplicateDetection';
import { styles } from '../styles/mediaWizardStyles';

export type ResultsScreenProps = {
  tab: ResultTab;
  scanState: ScanState;
  scanProgress: number;
  scanError: string | null;
  scanSummary: ScanSummary;
  selectedAlbum: Album | null;
  selectedLarge: string[];
  largeVideos: LargeVideo[];
  duplicateGroups: DuplicateGroup[];
  onTabChange: (tab: ResultTab) => void;
  onToggleLarge: (id: string) => void;
  onSelectAll: () => void;
  onRetry: () => void;
  onBack: () => void;
  onContinue: () => void;
  onDeleteDuplicateGroup: (group: DuplicateGroup) => void;
};

export function ResultsScreen(props: ResultsScreenProps) {
  const { scanState } = props;
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <ResultsHeader scanState={scanState} scanProgress={props.scanProgress} onBack={props.onBack} />
        {scanState === 'scanning' ? <ResultsScanState progress={props.scanProgress} album={props.selectedAlbum} /> : null}
        {scanState === 'error' ? <ResultsErrorState error={props.scanError} onRetry={props.onRetry} /> : null}
        {scanState !== 'scanning' && scanState !== 'error' ? <><ResultsSummary summary={props.scanSummary} albumTitle={props.selectedAlbum?.title} />
        <ResultsTabs value={props.tab} onChange={props.onTabChange} />
        <ResultsSections tab={props.tab} duplicateGroups={props.duplicateGroups} largeVideos={props.largeVideos} selectedLarge={props.selectedLarge} onToggleLarge={props.onToggleLarge} onSelectAll={props.onSelectAll} onContinue={props.onContinue} onDeleteDuplicateGroup={props.onDeleteDuplicateGroup} /></> : null}
      </ScrollView>
    </SafeAreaView>);
}
