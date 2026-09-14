import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const handleBackPress = () => {
      if (screen === 'results') {
        if (scanState === 'scanning') onConfirmScanAbort();
        else setScreen('home');
        return true;
      }

      if (screen === 'cleanup') {
        setScreen('results');
        return true;
      }

      if (screen === 'done') {
        onResetCompression();
        setScreen('home');
        return true;
      }

      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => subscription.remove();
  }, [onConfirmScanAbort, onResetCompression, scanState, screen]);

  return {
    screen,
    goHome: () => setScreen('home'),
    goResults: () => setScreen('results'),
    goCleanup: () => setScreen('cleanup'),
    goDone: () => setScreen('done'),
  };
}
