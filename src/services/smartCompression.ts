import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { getVideoMetaData, Video } from 'react-native-compressor';
import type { LargeVideo } from '../components/types/mediaWizardTypes';

export type CompressionQuality = 'balanced' | 'high' | 'maximum_savings';

export type VideoMetadata = {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number | null;
  codec: string;
  hasAudio: boolean;
  hdr: boolean;
};

export type CompressionPlan = {
  quality: CompressionQuality;
  targetBitrate: number;
  outputWidth: number;
  outputHeight: number;
  outputFps: number;
  estimatedOutputBytes: number;
  estimatedSavingsBytes: number;
  shouldSkip: boolean;
  reason?: string;
};

export type CompressionResult = {
  inputUri: string;
  outputUri: string;
  inputSizeBytes: number;
  outputSizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  codec: string;
};

export type StorageStrategy = {
  hasEnoughSpace: boolean;
  freeSpaceBytes: number;
  estimatedTotalBytesNeeded: number;
  deleteImmediately: boolean;
};

export type MediaPermissionStrategy = 'manage_media' | 'manage_external_storage' | 'fallback';

export async function getAndroidVersion(): Promise<number> {
  try {
    const { VERSION } = Platform.OS === 'android' ? require('react-native').Platform : { VERSION: 0 };
    return VERSION || 0;
  } catch {
    return 0;
  }
}

export function determineMediaPermissionStrategy(): MediaPermissionStrategy {
  if (Platform.OS !== 'android') return 'fallback';
  
  // Android 13+ API level 33
  const androidVersion = Platform.Version as number;
  if (androidVersion >= 33) {
    return 'manage_media';
  }
  // Android 10-12 API level 29-31
  if (androidVersion >= 29) {
    return 'manage_external_storage';
  }
  // Older versions - not supported
  return 'fallback';
}

export async function getDeviceStorageInfo(): Promise<{ freeBytes: number; totalBytes: number }> {
  try {
    const info = await FileSystem.getFreeDiskStorageAsync();
    const total = await FileSystem.getTotalDiskCapacityAsync();
    return { freeBytes: info, totalBytes: total };
  } catch (error) {
    console.warn('Failed to get device storage info:', error);
    // Default to assuming we have space; better to fail gracefully during compression
    return { freeBytes: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER };
  }
}

export function determineStorageStrategy(
  selectedVideos: Pick<LargeVideo, 'size' | 'duration' | 'estimatedOutputSize'>[],
  freeSpaceBytes: number,
  quality: CompressionQuality = 'balanced',
): StorageStrategy {
  // Estimate total space needed for all compressions
  // Worst case: store original + compressed for each video simultaneously
  let totalOriginalBytes = 0;
  let estimatedCompressedBytes = 0;

  for (const video of selectedVideos) {
    totalOriginalBytes += video.size;
    estimatedCompressedBytes += video.estimatedOutputSize;
  }

  // Total bytes needed: originals + all compressed (worst case, all exist at once)
  const estimatedTotalBytesNeeded = totalOriginalBytes + estimatedCompressedBytes;
  
  // Add a buffer of 500MB for system temp files
  const bufferBytes = 500 * 1024 * 1024;
  const hasEnoughSpace = freeSpaceBytes >= estimatedTotalBytesNeeded + bufferBytes;

  return {
    hasEnoughSpace,
    freeSpaceBytes,
    estimatedTotalBytesNeeded,
    deleteImmediately: !hasEnoughSpace,
  };
}

export function createCompressionPlan(
  video: Pick<LargeVideo, 'size' | 'duration'>,
  metadata: VideoMetadata,
  quality: CompressionQuality = 'balanced',
): CompressionPlan {
  const sourceBitrate = metadata.bitrate ?? Math.round((video.size * 8) / Math.max(video.duration, 1));
  const bitrateMultiplier = quality === 'high' ? 0.72 : quality === 'maximum_savings' ? 0.38 : 0.52;
  const targetBitrate = Math.max(1_000_000, Math.round(sourceBitrate * bitrateMultiplier));
  const longestEdge = Math.max(metadata.width, metadata.height);
  const reduceResolution = quality === 'maximum_savings' && longestEdge >= 3840;
  const rawMaxSize = reduceResolution ? 1920 : longestEdge;
  const outputWidth = rawMaxSize % 2 === 0 ? rawMaxSize : rawMaxSize + 1;
  const outputHeight = reduceResolution ? 1080 : Math.min(metadata.width, metadata.height);
  const outputFps = quality === 'maximum_savings' && metadata.fps > 30 ? 30 : metadata.fps;
  const audioBitrate = metadata.hasAudio ? 128_000 : 0;
  const estimatedOutputBytes = Math.round(((targetBitrate + audioBitrate) * Math.max(metadata.durationMs, 1)) / 8_000);
  const minimumUsefulSavings = Math.max(10 * 1024 * 1024, Math.round(video.size * 0.08));
  const estimatedSavingsBytes = Math.max(0, video.size - estimatedOutputBytes);

  if (video.size < minimumUsefulSavings || estimatedSavingsBytes < minimumUsefulSavings) {
    return {
      quality,
      targetBitrate,
      outputWidth,
      outputHeight,
      outputFps,
      estimatedOutputBytes,
      estimatedSavingsBytes: 0,
      shouldSkip: true,
      reason: 'This video has limited compression potential.',
    };
  }

  return {
    quality,
    targetBitrate,
    outputWidth,
    outputHeight,
    outputFps,
    estimatedOutputBytes,
    estimatedSavingsBytes,
    shouldSkip: false,
  };
}

export function estimatePlanFromAsset(video: Pick<LargeVideo, 'size' | 'duration'>, quality: CompressionQuality = 'balanced'): CompressionPlan {
  const durationMs = Math.max(video.duration, 1) * 1000;
  return createCompressionPlan(video, {
    durationMs,
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: null,
    codec: 'unknown',
    hasAudio: true,
    hdr: false,
  }, quality);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function compressVideo(
  inputUri: string,
  video: Pick<LargeVideo, 'size' | 'duration'>,
  quality: CompressionQuality,
  onProgress: (progress: number) => void,
  signal: { cancelled: boolean },
): Promise<CompressionResult> {
  try {
    let sourceMetadata;
    try {
      sourceMetadata = await getVideoMetaData(inputUri);
    } catch (error) {
      throw new Error(`Input video is unreadable or corrupted: ${error instanceof Error ? error.message : 'unknown'}`);
    }

    if (sourceMetadata.duration <= 0) {
      throw new Error('Video has invalid duration');
    }

    const metadata: VideoMetadata = {
      durationMs: sourceMetadata.duration * 1000,
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      fps: 30,
      bitrate: null,
      codec: 'unknown',
      hasAudio: true,
      hdr: false,
    };
    const plan = createCompressionPlan(video, metadata, quality);
    if (plan.shouldSkip) throw new Error(plan.reason ?? 'Compression is not worthwhile for this video.');

    let cancellationId = '';
    let outputUri: string = '';

    try {
      outputUri = await Video.compress(inputUri, {
        compressionMethod: 'manual',
        bitrate: plan.targetBitrate,
        maxSize: plan.outputWidth,
        getCancellationId: (id) => { cancellationId = id; },
      }, (progress) => {
        if (signal.cancelled && cancellationId) {
          try {
            Video.cancelCompression(cancellationId);
          } catch (e) {
            // Ignore cancellation errors
          }
        }
        onProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
      });
    } catch (compressionError) {
      const errorMessage = compressionError instanceof Error ? compressionError.message : String(compressionError);
      
      // Provide diagnostic info
      const diagnostics = [
        `Video: ${video.size / (1024 * 1024)}MB`,
        `Duration: ${video.duration}s`,
        `Resolution: ${sourceMetadata.width}x${sourceMetadata.height}`,
        `Native error: ${errorMessage || '(no message)'}`,
      ].join(' | ');
      
      throw new Error(`Compression failed [${diagnostics}]`);
    }

    if (!outputUri) {
      throw new Error('Compression did not produce an output path.');
    }

    // Verify output file exists and has content
    const outputFile = new File(outputUri);
    let fileReady = false;
    let checkAttempts = 0;
    
    while (checkAttempts < 5 && !fileReady) {
      try {
        if (outputFile.exists && outputFile.size > 0) {
          fileReady = true;
          break;
        }
        checkAttempts++;
        if (checkAttempts < 5) await delay(300);
      } catch (e) {
        checkAttempts++;
        if (checkAttempts < 5) await delay(300);
      }
    }

    if (!fileReady) {
      throw new Error('Compression produced no output file. Check device storage and permissions.');
    }

    let outputMetadata;
    try {
      outputMetadata = await getVideoMetaData(outputUri);
    } catch (metadataError) {
      try {
        outputFile.delete();
      } catch (deleteError) {
        // Ignore delete errors
      }
      const message = metadataError instanceof Error ? metadataError.message : String(metadataError);
      throw new Error(`Compressed video is unreadable: ${message}`);
    }

    if (outputMetadata.duration < sourceMetadata.duration * 0.9) {
      try {
        outputFile.delete();
      } catch (deleteError) {
        // Ignore delete errors
      }
      throw new Error('Compressed video lost significant duration data. Original preserved.');
    }
    
    if (outputFile.size >= video.size) {
      try {
        outputFile.delete();
      } catch (deleteError) {
        // Ignore delete errors
      }
      throw new Error('Compression produced larger file. Original preserved.');
    }
    
    return {
      inputUri,
      outputUri,
      inputSizeBytes: video.size,
      outputSizeBytes: outputFile.size,
      durationMs: outputMetadata.duration * 1000,
      width: outputMetadata.width,
      height: outputMetadata.height,
      codec: metadata.codec,
    };
  } catch (error) {
    // Re-throw with context
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected compression error: ${String(error)}`);
  }
}
