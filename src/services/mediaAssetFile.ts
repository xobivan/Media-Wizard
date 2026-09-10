import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Platform } from 'react-native';

export async function getMediaFile(asset: MediaLibrary.Asset): Promise<File> {
  if (Platform.OS === 'android') {
    return new File(asset.uri);
  }

  const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
  return new File(info.localUri ?? asset.uri);
}
