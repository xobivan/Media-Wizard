import { getPhotoSignatures, isAvailable } from '../../modules/thumbnail-signatures';

/**
 * Calculates the Hamming distance (number of differing bits) between two 64-bit hex pHash strings.
 */
export function calculateHammingDistance(pHash1: string, pHash2: string): number {
  if (pHash1.length !== 16 || pHash2.length !== 16) {
    throw new Error(`pHash strings must be 16 hex characters. Got lengths ${pHash1.length} and ${pHash2.length}`);
  }

  const val1 = BigInt(`0x${pHash1}`);
  const val2 = BigInt(`0x${pHash2}`);
  let xorVal = val1 ^ val2;

  let distance = 0;
  while (xorVal > 0n) {
    distance += Number(xorVal & 1n);
    xorVal >>= 1n;
  }
  return distance;
}

export type BenchmarkTimingResult = {
  totalPhotos: number;
  totalDurationMs: number;
  msPerPhoto: number;
};

export type DetectionBoundaryResult = {
  label: string;
  uriA: string;
  uriB: string;
  pHashA: string;
  pHashB: string;
  hammingDistance: number;
  expectedCategory: 'identical' | 'different' | 'resized_compressed';
  passed: boolean;
};

/**
 * Benchmark 1: Measure Cost (Execution Time & Batching Performance)
 */
export async function benchmarkNativeSignaturesPerformance(
  photoUris: string[],
  batchSize = 50
): Promise<BenchmarkTimingResult> {
  if (!isAvailable()) {
    throw new Error('ThumbnailSignatures native module is not available on this platform/build.');
  }

  const start = performance.now();

  for (let offset = 0; offset < photoUris.length; offset += batchSize) {
    const batch = photoUris.slice(offset, offset + batchSize);
    await getPhotoSignatures(batch);
  }

  const totalDurationMs = performance.now() - start;
  const msPerPhoto = photoUris.length > 0 ? totalDurationMs / photoUris.length : 0;

  console.log(
    `[Native Thumbnail Benchmark] Handled ${photoUris.length} photos in ${totalDurationMs.toFixed(
      2
    )}ms (${msPerPhoto.toFixed(2)} ms/photo)`
  );

  return {
    totalPhotos: photoUris.length,
    totalDurationMs,
    msPerPhoto,
  };
}

/**
 * Benchmark 2: Measure Detection Boundaries (Accuracy & Hamming Distance)
 *
 * Checks:
 * 1. Identical / Duplicate photos: Hamming distance <= 3..5
 * 2. Resized / Compressed copies: Hamming distance <= 5..8
 * 3. Different photos: Hamming distance > 12..15
 */
export async function benchmarkDetectionBoundaries(
  testPairs: Array<{
    label: string;
    uriA: string;
    uriB: string;
    expectedCategory: 'identical' | 'different' | 'resized_compressed';
  }>
): Promise<DetectionBoundaryResult[]> {
  if (!isAvailable()) {
    throw new Error('ThumbnailSignatures native module is not available on this platform/build.');
  }

  const allUris = Array.from(new Set(testPairs.flatMap((p) => [p.uriA, p.uriB])));
  const signatures = await getPhotoSignatures(allUris);

  const sigMap = new Map<string, string>();
  for (const sig of signatures) {
    if ('pHash' in sig && typeof sig.pHash === 'string') {
      sigMap.set(sig.uri, sig.pHash);
    }
  }

  const results: DetectionBoundaryResult[] = [];

  for (const pair of testPairs) {
    const pHashA = sigMap.get(pair.uriA);
    const pHashB = sigMap.get(pair.uriB);

    if (!pHashA || !pHashB) {
      results.push({
        label: pair.label,
        uriA: pair.uriA,
        uriB: pair.uriB,
        pHashA: pHashA ?? 'ERROR_MISSING',
        pHashB: pHashB ?? 'ERROR_MISSING',
        hammingDistance: -1,
        expectedCategory: pair.expectedCategory,
        passed: false,
      });
      continue;
    }

    const dist = calculateHammingDistance(pHashA, pHashB);
    let passed = false;

    if (pair.expectedCategory === 'identical') {
      passed = dist <= 5;
    } else if (pair.expectedCategory === 'resized_compressed') {
      passed = dist <= 8;
    } else if (pair.expectedCategory === 'different') {
      passed = dist > 12;
    }

    results.push({
      label: pair.label,
      uriA: pair.uriA,
      uriB: pair.uriB,
      pHashA,
      pHashB,
      hammingDistance: dist,
      expectedCategory: pair.expectedCategory,
      passed,
    });
  }

  return results;
}
