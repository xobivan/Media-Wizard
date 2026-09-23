import { requireOptionalNativeModule } from 'expo-modules-core';

export type NativeThumbnailSignatureSuccess = {
  uri: string;
  pHash: string;
  grayscale: string;
  histogram: number[];
  error?: undefined;
};

export type NativeThumbnailSignatureError = {
  uri: string;
  error: string;
};

export type NativeThumbnailSignature = NativeThumbnailSignatureSuccess | NativeThumbnailSignatureError;

export interface ThumbnailSignaturesModule {
  getPhotoSignatures(uris: string[]): Promise<NativeThumbnailSignature[]>;
  getVideoFrameSignatures(uris: string[], frameTimes: number[][]): Promise<NativeVideoFrameSignature[]>;
}

export type NativeVideoFrameSignatureSuccess = {
  uri: string;
  frameHashes: string[];
  error?: undefined;
};

export type NativeVideoFrameSignatureError = {
  uri: string;
  error: string;
};

export type NativeVideoFrameSignature =
  | NativeVideoFrameSignatureSuccess
  | NativeVideoFrameSignatureError;

const nativeModule = requireOptionalNativeModule<ThumbnailSignaturesModule>('ThumbnailSignatures');

export default nativeModule;

export function isAvailable(): boolean {
  return nativeModule !== null;
}

export async function getPhotoSignatures(uris: string[]): Promise<NativeThumbnailSignature[]> {
  if (!nativeModule) {
    throw new Error('ThumbnailSignatures native module is not available.');
  }
  return nativeModule.getPhotoSignatures(uris);
}

export async function getVideoFrameSignatures(
  uris: string[],
  frameTimes: number[][],
): Promise<NativeVideoFrameSignature[]> {
  if (!nativeModule) {
    throw new Error('ThumbnailSignatures native module is not available.');
  }
  return nativeModule.getVideoFrameSignatures(uris, frameTimes);
}

