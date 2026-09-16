import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import type { ScanState } from '../components/types/mediaWizardTypes';

export type Screen = 'home' | 'results' | 'cleanup' | 'done';

type AppNavigationOptions = {
  scanState: ScanState;
  onConfirmScanAbort: () => void;
  onResetCompression: () => void;
};

export function useAppNavigation({
  scanState,
  onConfirmScanAbort,
  onResetCompression,
}: AppNavigationOptions) {
  const [screen, setScreen] = useState<Screen>('home');
  const onConfirmScanAbortRef = useRef(onConfirmScanAbort);
  const onResetCompressionRef = useRef(onResetCompression);

  onConfirmScanAbortRef.current = onConfirmScanAbort;
  onResetCompressionRef.current = onResetCompression;

  useEffect(() => {
    const handleBackPress = () => {
      if (screen === 'results') {
        if (scanState === 'scanning') onConfirmScanAbortRef.current();
        else setScreen('home');
        return true;
      }

      if (screen === 'cleanup') {
        setScreen('results');
        return true;
      }

      if (screen === 'done') {
        onResetCompressionRef.current();
        setScreen('home');
        return true;
      }

      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => subscription.remove();
  }, [scanState, screen]);

  const goHome = useCallback(() => setScreen('home'), []);
  const goResults = useCallback(() => setScreen('results'), []);
  const goCleanup = useCallback(() => setScreen('cleanup'), []);
  const goDone = useCallback(() => setScreen('done'), []);

  return {
    screen,
    goHome,
    goResults,
    goCleanup,
    goDone,
  };
}
