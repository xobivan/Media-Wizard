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

export async function deleteMediaFileAsync(asset: MediaLibrary.Asset): Promise<void> {
  try {
    // Try direct file deletion first (respects storage permissions on Android 10+/13+)
    const file = await getMediaFile(asset);
    file.delete();
  } catch (fileError) {
    // Fall back to MediaLibrary deletion if file deletion fails
    try {
      await MediaLibrary.deleteAssetsAsync([asset.id]);
    } catch (libraryError) {
      throw libraryError;
    }
  }
}
