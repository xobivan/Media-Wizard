import { File } from 'expo-file-system';
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

export function createCompressionPlan(
  video: Pick<LargeVideo, 'size' | 'duration'>,
  metadata: VideoMetadata,
  quality: CompressionQuality = 'balanced',
): CompressionPlan {
  const sourceBitrate = metadata.bitrate ?? Math.round((video.size * 8) / Math.max(video.duration, 1));
  const bitrateMultiplier = quality === 'high' ? 0.72 : quality === 'maximum_savings' ? 0.38 : 0.52;
  const targetBitrate = Math.max(1_000_000, Math.round(sourceBitrate * bitrateMultiplier));
  const reduceResolution = quality === 'maximum_savings' && metadata.width >= 3840;
  const outputWidth = reduceResolution ? 1920 : metadata.width;
  const outputHeight = reduceResolution ? 1080 : metadata.height;
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

export async function compressVideo(
  inputUri: string,
  video: Pick<LargeVideo, 'size' | 'duration'>,
  quality: CompressionQuality,
  onProgress: (progress: number) => void,
  signal: { cancelled: boolean },
): Promise<CompressionResult> {
  const sourceMetadata = await getVideoMetaData(inputUri);
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
  const outputUri = await Video.compress(inputUri, {
    compressionMethod: 'manual',
    bitrate: plan.targetBitrate,
    maxSize: Math.max(plan.outputWidth, plan.outputHeight),
    getCancellationId: (id) => { cancellationId = id; },
  }, (progress) => {
    if (signal.cancelled && cancellationId) Video.cancelCompression(cancellationId);
    onProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
  });

  const outputFile = new File(outputUri);
  if (!outputFile.exists || outputFile.size <= 0) throw new Error('The compressed video was empty or could not be verified.');
  const outputMetadata = await getVideoMetaData(outputUri);
  if (outputMetadata.duration < sourceMetadata.duration * 0.9) {
    outputFile.delete();
    throw new Error('The compressed video did not preserve the source duration; the original was kept.');
  }
  if (outputFile.size >= video.size) {
    outputFile.delete();
    throw new Error('Compression did not produce a smaller video; the original was kept.');
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
}
