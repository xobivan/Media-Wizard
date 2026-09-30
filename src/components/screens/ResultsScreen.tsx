import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ResultsHeader } from '../results/ResultsHeader';
import { ResultsScanState, ResultsErrorState } from '../results/ResultsScanState';
import { ResultsSummary } from '../results/ResultsSummary';
import { ResultsTabs } from '../results/ResultsTabs';
import { ResultsSections } from '../results/ResultsSections';
import { CompressionBottomSheet } from './CompressionBottomSheet';
import type { Album, LargeVideo, ResultTab, ScanState, ScanSummary, ScanTarget } from '../types/mediaWizardTypes';
import type { DuplicateGroup } from '../../services/duplicateDetection';
import type { CompressionQuality } from '../../services/smartCompression';
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
  scanTargets: ScanTarget[];
  // Compression state
  keepOriginals: boolean;
  compressionQuality: CompressionQuality;
  compressionState: 'idle' | 'compressing' | 'complete' | 'error';
  compressionProgress: number;
  compressionCurrent: number;
  compressionError: string | null;
  estimatedSavings: number;
  selectedSavings: number;
  // Handlers
  onTabChange: (tab: ResultTab) => void;
  onToggleLarge: (id: string) => void;
  onSelectAll: () => void;
  onRetry: () => void;
  onBack: () => void;
  onFinish: () => void;
  onDeleteDuplicateGroup: (group: DuplicateGroup) => void;
  onDeleteAllDuplicateGroups: (groups: DuplicateGroup[]) => void;
  onAbortScan: () => void;
  onKeepOriginalsChange: (keep: boolean) => void;
  onCompressionQualityChange: (quality: CompressionQuality) => void;
  onStartCompression: () => void;
  onRequestCancelCompression: () => void;
  onCancelCompressionConfirmed: () => void;
};

export function ResultsScreen(props: ResultsScreenProps) {
  const { scanState } = props;
  const [compressionSheetVisible, setCompressionSheetVisible] = useState(false);

  const openCompressionSheet = () => setCompressionSheetVisible(true);
  const closeCompressionSheet = () => setCompressionSheetVisible(false);

  const handleCancelConfirmed = () => {
    props.onCancelCompressionConfirmed();
    closeCompressionSheet();
  };

  const handleDismissSuccess = () => {
    closeCompressionSheet();
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <ResultsHeader
          scanState={scanState}
          scanProgress={props.scanProgress}
          onBack={props.onBack}
          onFinish={scanState !== 'scanning' ? props.onFinish : undefined}
        />
        {scanState === 'scanning' ? (
          <ResultsScanState
            progress={props.scanProgress}
            album={props.selectedAlbum}
            onAbort={props.onAbortScan}
          />
        ) : null}
        {scanState === 'error' ? (
          <ResultsErrorState error={props.scanError} onRetry={props.onRetry} />
        ) : null}
        {scanState !== 'scanning' && scanState !== 'error' ? (
          <>
            <ResultsSummary
              summary={props.scanSummary}
              albumTitle={props.selectedAlbum?.title}
              estimatedSavings={props.estimatedSavings}
              scanTargets={props.scanTargets}
            />
            <ResultsTabs
              value={props.tab}
              onChange={props.onTabChange}
              scanTargets={props.scanTargets}
            />
            <ResultsSections
              tab={props.tab}
              duplicateGroups={props.duplicateGroups}
              largeVideos={props.largeVideos}
              selectedLarge={props.selectedLarge}
              onToggleLarge={props.onToggleLarge}
              onSelectAll={props.onSelectAll}
              onOpenCompressionSheet={openCompressionSheet}
              onDeleteDuplicateGroup={props.onDeleteDuplicateGroup}
              onDeleteAllDuplicateGroups={props.onDeleteAllDuplicateGroups}
            />
          </>
        ) : null}
      </ScrollView>

      <CompressionBottomSheet
        visible={compressionSheetVisible}
        selectedCount={props.selectedLarge.length}
        selectedSavings={props.selectedSavings}
        keepOriginals={props.keepOriginals}
        compressionQuality={props.compressionQuality}
        compressionState={props.compressionState}
        compressionProgress={props.compressionProgress}
        compressionCurrent={props.compressionCurrent}
        compressionError={props.compressionError}
        onKeepOriginalsChange={props.onKeepOriginalsChange}
        onCompressionQualityChange={props.onCompressionQualityChange}
        onStartCompression={props.onStartCompression}
        onRequestCancel={props.onRequestCancelCompression}
        onCancelConfirmed={handleCancelConfirmed}
        onDismiss={handleDismissSuccess}
      />
    </SafeAreaView>
  );
}
