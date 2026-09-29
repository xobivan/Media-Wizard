import * as MediaLibrary from 'expo-media-library/legacy';
import type { LargeVideo } from '../components/types/mediaWizardTypes';
import { getMediaFile } from './mediaAssetFile';
import { estimatePlanFromAsset } from './smartCompression';

export const LARGE_VIDEO_THRESHOLD = 200 * 1024 * 1024;

export async function findLargeVideos(
  assets: MediaLibrary.Asset[],
  onProgress?: (progress: number) => void,
): Promise<LargeVideo[]> {
  const largeVideos: LargeVideo[] = [];
  const videos = assets.filter((asset) => asset.mediaType === 'video');

  for (let index = 0; index < videos.length; index += 1) {
    const asset = videos[index];
    const mediaFile = await getMediaFile(asset);
    const size = mediaFile.size;

    if (typeof size === 'number' && size >= LARGE_VIDEO_THRESHOLD) {
      const plan = estimatePlanFromAsset({ size, duration: asset.duration });
      largeVideos.push({
        id: asset.id,
        name: asset.filename,
        detail: `${formatBytes(size)} · ${formatDuration(asset.duration)}`,
        savings: Math.round(plan.estimatedSavingsBytes / (1024 * 1024)),
        size,
        duration: asset.duration,
        estimatedOutputSize: plan.estimatedOutputBytes,
        canCompress: !plan.shouldSkip,
        localUri: mediaFile.uri,
      });
    }

    onProgress?.(Math.round(((index + 1) / videos.length) * 100));
  }

  return largeVideos;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}
