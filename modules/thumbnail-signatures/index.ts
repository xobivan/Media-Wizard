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
}

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
