import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useState } from 'react';
import type { PermissionState } from '../components/types/mediaWizardTypes';
import { determineMediaPermissionStrategy, type MediaPermissionStrategy } from '../services/smartCompression';

export function useMediaPermissions() {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [mediaPermissionStrategy, setMediaPermissionStrategy] = useState<MediaPermissionStrategy>('fallback');

  useEffect(() => {
    let mounted = true;
    const loadPermission = async () => {
      const response = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      if (!mounted) return;
      setPermission(response.status === 'granted' ? response.accessPrivileges === 'limited' ? 'limited' : 'granted' : 'denied');
      
      // Determine and request media deletion permission strategy
      const strategy = determineMediaPermissionStrategy();
      setMediaPermissionStrategy(strategy);
      
      if (strategy === 'manage_media' || strategy === 'manage_external_storage') {
        // Request the appropriate permission for seamless deletion
        try {
          await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
        } catch (error) {
          console.warn('Failed to request media permission:', error);
        }
      }
    };
    void loadPermission();
    return () => {
      mounted = false;
    };
  }, []);

  const requestMediaPermission = async () => {
    const response = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
    setPermission(response.status === 'granted' ? response.accessPrivileges === 'limited' ? 'limited' : 'granted' : 'denied');
  };

  return {
    permission,
    mediaPermissionStrategy,
    requestMediaPermission,
  };
}
