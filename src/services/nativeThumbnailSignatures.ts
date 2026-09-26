import nativeModule, {
  isAvailable as isNativeThumbnailSignaturesAvailableModule,
  getPhotoSignatures,
  getVideoFrameSignatures,
  type NativeThumbnailSignatureSuccess,
  type NativeVideoFrameSignatureSuccess,
} from '../../modules/thumbnail-signatures';

export type ThumbnailSignature = NativeThumbnailSignatureSuccess;

const BATCH_SIZE = 50;
const VIDEO_BATCH_SIZE = 50;

export function isNativeThumbnailSignaturesAvailable(): boolean {
  return isNativeThumbnailSignaturesAvailableModule();
}

/**
 * Requests native 128px MediaStore previews in modest batches. Assets with a failed thumbnail
 * request are omitted so callers can retain their existing conservative fallback behaviour.
 */
export async function getNativePhotoSignatures(
  uris: string[],
  onProgressBatch?: (completedCount: number) => void
): Promise<ThumbnailSignature[]> {
  if (!isNativeThumbnailSignaturesAvailableModule()) return [];

  const signatures: ThumbnailSignature[] = [];
  for (let offset = 0; offset < uris.length; offset += BATCH_SIZE) {
    const batch = await getPhotoSignatures(uris.slice(offset, offset + BATCH_SIZE));
    signatures.push(
      ...batch.filter((result): result is NativeThumbnailSignatureSuccess => 'pHash' in result && typeof result.pHash === 'string')
    );
    onProgressBatch?.(signatures.length);
  }
  return signatures;
}

export async function getNativeVideoFrameSignatures(
  uris: string[],
  frameTimes: number[][],
  onProgressBatch?: (completedCount: number) => void
): Promise<NativeVideoFrameSignatureSuccess[]> {
  if (!isNativeThumbnailSignaturesAvailableModule()) return [];

  const signatures: NativeVideoFrameSignatureSuccess[] = [];
  for (let offset = 0; offset < uris.length; offset += VIDEO_BATCH_SIZE) {
    const end = Math.min(offset + VIDEO_BATCH_SIZE, uris.length);
    const batch = await getVideoFrameSignatures(
      uris.slice(offset, end),
      frameTimes.slice(offset, end)
    );
    signatures.push(
      ...batch.filter(
        (r): r is NativeVideoFrameSignatureSuccess =>
          'frameHashes' in r && Array.isArray(r.frameHashes)
      )
    );
    onProgressBatch?.(signatures.length);
  }
  return signatures;
}

