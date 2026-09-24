# Video First-Frame Extraction Optimization

## Profiler Baseline (S21, 6,718 assets)

Real profiler data from the latest scan after native photo pHash implementation:

### Time Budget — Full Scan

| Phase | Time | % of Total |
|-------|------|-----------|
| **Video duplicates (total)** | **145.1s** | **56%** |
| Photo duplicates (total) | 94.0s | 36% |
| Metadata grouping | 14.5s | 6% |
| Media library load | 3.6s | 1% |
| Large video detection | 2.2s | 1% |
| **Total scan** | **~259s (~4.3 min)** | |

### Video First-Frame Pass (Pass 1) — The Bottleneck

351 candidate videos, `VIDEO_FINGERPRINT_CONCURRENCY = 2`:

| Step | Total | Avg/video | % of Pass 1 |
|------|-------|-----------|-------------|
| **Frame extraction** (`generateThumbnailsAsync`) | **236.6s** | **674 ms** | **92.8%** |
| Player create | 8.9s | 24 ms | 3.5% |
| Player release | 3.7s | 10 ms | 1.5% |
| PNG save | 2.6s | 7 ms | 1.0% |
| Frame render | 1.0s | 3 ms | 0.4% |
| Get media file | 0.7s | 2 ms | 0.3% |
| MD5 hash | 0.5s | 1 ms | 0.2% |
| Temp file delete | 0.3s | 1 ms | 0.1% |
| **Pass 1 total** | **254.9s** | **726 ms** | **100%** |

### Video Full Fingerprint (Pass 2)

Only 14 of 351 videos had a first-frame collision — progressive filtering eliminated **96% of full extractions**:

| Step | Total | Avg/video |
|------|-------|-----------|
| Thumbnail extraction (3 frames) | 30.4s | 2,169 ms |
| **Pass 2 total** | **31.2s** | **2,231 ms** |

### Key Insight

**93% of video fingerprinting time is inside `expo-video`'s `generateThumbnailsAsync`** — not player lifecycle, not PNG I/O, not hashing. The PNG round-trip (save + render + hash + delete) adds only ~4.4s total across 370 frame operations. The optimization must target the **frame extraction mechanism itself**.

This means:
- ❌ Eliminating PNG I/O alone would save only **~4.4s** (~1.7%) — not worth the complexity
- ❌ Increasing concurrency alone would help ~1.3–1.5× but doesn't fix the per-video cost
- ✅ **Replacing `expo-video` with `MediaMetadataRetriever` / `AVAssetImageGenerator`** targets the 236.6s directly

---

## Proposed Changes — Native Video Frame Fingerprinting (Both Passes)

Extend the existing `modules/thumbnail-signatures` native module to handle **all** video frame extraction + pHash computation natively, eliminating `expo-video` from the fingerprinting pipeline entirely.

### Architecture Overview

```
BEFORE (per video, per frame — 674 ms avg):
  JS ──createVideoPlayer──► expo-video (full playback decoder)    24 ms
  JS ──generateThumbnailsAsync──► expo-video                     674 ms  ← 93% of cost
  JS ──manipulate().renderAsync()──► ImageManipulator               3 ms
  JS ──saveAsync(PNG)──► disk write                                 7 ms
  JS ──File.md5──► disk read + hash                                 1 ms
  JS ──delete()──► disk cleanup                                     1 ms
  JS ──release()──► decoder teardown                               10 ms

AFTER (batched, all frames — expected ~100 ms avg):
  JS ──getVideoFrameSignatures(uris[], frameTimes[][])──► Native module
    Native: MediaMetadataRetriever.getFrameAtTime()  — lightweight, no player
    Native: createScaledBitmap(32×32)                — reuse existing photo path
    Native: perceptualHash(luminance)                — reuse existing DCT pHash
  JS ◄── { uri, frameHashes: [pHash1, pHash2, pHash3] }
```

### Why `MediaMetadataRetriever` Should Be Faster

`expo-video`'s `generateThumbnailsAsync` internally:
1. Allocates a full `MediaCodec` decoder session with a `Surface`
2. Configures a playback pipeline (audio + video tracks)
3. Seeks to the timestamp through the player's state machine
4. Renders the frame and scales it

`MediaMetadataRetriever.getFrameAtTime()`:
1. Opens the file with a lightweight metadata parser
2. Seeks directly to the nearest sync frame (`OPTION_CLOSEST_SYNC`)
3. Decodes that single frame — no player state machine, no Surface, no audio track

The overhead difference is well-documented: `MediaMetadataRetriever` is the standard Android API for thumbnail generation (it's what the Gallery app uses), while `expo-video` wraps ExoPlayer which is designed for continuous playback.

---

### What Changes at Each Layer

---

#### Native Module — Android

##### [MODIFY] `modules/thumbnail-signatures/android/src/main/java/com/mediawizard/thumbnailsignatures/ThumbnailSignaturesModule.kt`

Add a new `AsyncFunction("getVideoFrameSignatures")` alongside the existing `getPhotoSignatures`:

```kotlin
AsyncFunction("getVideoFrameSignatures") { uris: List<String>, frameTimes: List<List<Double>> ->
  val resolver = requireNotNull(appContext.reactContext).contentResolver
  runBlocking {
    uris.mapIndexed { index, uriString ->
      async(Dispatchers.IO) {
        try {
          val retriever = MediaMetadataRetriever()
          try {
            val parsedUri = Uri.parse(uriString)
            if (parsedUri.scheme == "file") {
              retriever.setDataSource(parsedUri.path)
            } else {
              retriever.setDataSource(resolver.openFileDescriptor(parsedUri, "r")!!.fileDescriptor)
            }

            val times = frameTimes[index]
            val hashes = times.map { timeSec ->
              val timeUs = (timeSec * 1_000_000).toLong()
              val frame = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: throw IllegalStateException("No frame at ${timeSec}s")
              try {
                // Reuse existing createSignature → perceptualHash pipeline
                val signature = createSignature(uriString, frame)
                signature["pHash"] as String
              } finally {
                frame.recycle()
              }
            }

            mapOf("uri" to uriString, "frameHashes" to hashes)
          } finally {
            retriever.release()
          }
        } catch (error: Exception) {
          mapOf("uri" to uriString, "error" to (error.message ?: error.javaClass.simpleName))
        }
      }
    }.map { it.await() }
  }
}
```

Key details:
- `MediaMetadataRetriever` is far cheaper than `createVideoPlayer` — no `MediaCodec` session, no `Surface`, no playback state machine
- `OPTION_CLOSEST_SYNC` seeks to the nearest keyframe (fast); for multi-frame fingerprinting the same sync-frame selection will be consistent across re-encodes of the same video
- Reuses existing `createSignature()` (Bitmap → 32×32 grayscale → luminance → DCT pHash) — **zero new hashing code**
- Same `Dispatchers.IO` coroutine parallelism as the photo path
- `retriever.release()` in `finally` — same cleanup discipline as existing module

---

#### Native Module — iOS

##### [MODIFY] `modules/thumbnail-signatures/ios/ThumbnailSignaturesModule.swift`

Add matching `AsyncFunction("getVideoFrameSignatures")`:

```swift
AsyncFunction("getVideoFrameSignatures") { (uris: [String], frameTimes: [[Double]], promise: Promise) in
  DispatchQueue.global(qos: .userInitiated).async {
    let group = DispatchGroup()
    var results = [[String: Any]?](repeating: nil, count: uris.count)
    let lock = NSLock()

    for (index, uri) in uris.enumerated() {
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        let entry = Self.processVideoURI(uri, frameTimes: frameTimes[index])
        lock.lock()
        results[index] = entry
        lock.unlock()
        group.leave()
      }
    }

    group.wait()
    promise.resolve(results.compactMap { $0 })
  }
}
```

With a new helper:

```swift
private static func processVideoURI(_ uri: String, frameTimes: [Double]) -> [String: Any] {
  let url: URL
  if uri.hasPrefix("ph://") {
    let id = String(uri.dropFirst("ph://".count))
    guard let phAsset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject,
          let localURL = resolveLocalVideoURL(for: phAsset) else {
      return ["uri": uri, "error": "Could not resolve ph:// video asset"]
    }
    url = localURL
  } else {
    let path = uri.hasPrefix("file://") ? String(uri.dropFirst("file://".count)) : uri
    url = URL(fileURLWithPath: path)
  }

  let asset = AVAsset(url: url)
  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.maximumSize = CGSize(width: 128, height: 128)

  var hashes: [String] = []
  for time in frameTimes {
    let cmTime = CMTime(seconds: time, preferredTimescale: 600)
    do {
      let cgImage = try generator.copyCGImage(at: cmTime, actualTime: nil)
      let uiImage = UIImage(cgImage: cgImage)
      let signature = createSignature(uri: uri, image: uiImage)
      guard let pHash = signature["pHash"] as? String else {
        return ["uri": uri, "error": "pHash computation failed at \(time)s"]
      }
      hashes.append(pHash)
    } catch {
      return ["uri": uri, "error": error.localizedDescription]
    }
  }

  return ["uri": uri, "frameHashes": hashes]
}
```

Key details:
- `AVAssetImageGenerator` is purpose-built for frame extraction — no `AVPlayer` allocation
- `appliesPreferredTrackTransform = true` handles video rotation metadata automatically
- `maximumSize = CGSize(128, 128)` avoids decoding full-resolution frames
- Same `createSignature()` → `computePerceptualHash()` reuse as photo path
- For `ph://` URIs: resolve via `PHAsset.requestContentEditingInput` with `isNetworkAccessAllowed = false`

---

#### TypeScript Layer

##### [MODIFY] `modules/thumbnail-signatures/index.ts`

Add types and export for the new function:

```typescript
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

export async function getVideoFrameSignatures(
  uris: string[],
  frameTimes: number[][],
): Promise<NativeVideoFrameSignature[]> {
  if (!nativeModule) {
    throw new Error('ThumbnailSignatures native module is not available.');
  }
  return nativeModule.getVideoFrameSignatures(uris, frameTimes);
}
```

##### [MODIFY] `src/services/nativeThumbnailSignatures.ts`

Add batched video function with same pattern as `getNativePhotoSignatures`:

```typescript
const VIDEO_BATCH_SIZE = 50;

export async function getNativeVideoFrameSignatures(
  uris: string[],
  frameTimes: number[][],
  onProgressBatch?: (completedCount: number) => void,
): Promise<NativeVideoFrameSignatureSuccess[]> {
  if (!isNativeThumbnailSignaturesAvailableModule()) return [];

  const signatures: NativeVideoFrameSignatureSuccess[] = [];
  for (let offset = 0; offset < uris.length; offset += VIDEO_BATCH_SIZE) {
    const end = Math.min(offset + VIDEO_BATCH_SIZE, uris.length);
    const batch = await getVideoFrameSignatures(
      uris.slice(offset, end),
      frameTimes.slice(offset, end),
    );
    signatures.push(
      ...batch.filter(
        (r): r is NativeVideoFrameSignatureSuccess =>
          'frameHashes' in r && Array.isArray(r.frameHashes),
      ),
    );
    onProgressBatch?.(signatures.length);
  }
  return signatures;
}
```

---

##### [MODIFY] `src/services/duplicateDetection.ts`

Replace both video passes with native bulk calls.

**Pass 1** (lines 138–156) — replace the `inFlightVideos` loop:

```typescript
// --- Pass 1: Native first-frame pHash for all candidate videos ---
if (isNativeThumbnailSignaturesAvailable() && videoCandidates.length > 0) {
  const videoUris = videoCandidates.map(c => c.asset.uri);
  const firstFrameTimes = videoCandidates.map(c => [getVideoFrameTimes(c.asset)[0]]);
  const signatures = await timed('deep.video-first-frame.native-batch', () =>
    getNativeVideoFrameSignatures(videoUris, firstFrameTimes, (completedCount) => {
      onProgress?.(50 + Math.round((completedCount / candidates.length) * 25));
    })
  );

  const sigMap = new Map<string, string>();
  for (const sig of signatures) {
    if (sig.frameHashes.length > 0) sigMap.set(sig.uri, sig.frameHashes[0]);
  }

  for (const candidate of videoCandidates) {
    const pHash = sigMap.get(candidate.asset.uri);
    if (pHash) {
      videoFirstFrameResults.push({ candidate, firstFrameFingerprint: pHash });
    } else {
      // Fallback to JS path for URIs that failed natively
      const fp = await timed('deep.video-first-frame.total', () =>
        getVideoFirstFrameFingerprint(candidate.asset)
      );
      videoFirstFrameResults.push({ candidate, firstFrameFingerprint: fp });
    }
  }
} else {
  // Existing JS fallback loop (unchanged)
  ...
}
```

**Pass 2** (lines 165–190) — replace the `inFlightVideoFull` loop:

```typescript
// --- Pass 2: Native mid+end frame pHash for colliding videos only ---
const collidingCandidates: { candidate: Candidate; firstFramePHash: string }[] = [];
for (const group of videosByFirstFrame.values()) {
  if (group.length === 1) {
    recordFingerprint(group[0].candidate, group[0].firstFrameFingerprint);
    continue;
  }
  for (const entry of group) {
    collidingCandidates.push({
      candidate: entry.candidate,
      firstFramePHash: entry.firstFrameFingerprint,
    });
  }
}

if (isNativeThumbnailSignaturesAvailable() && collidingCandidates.length > 0) {
  const collidingUris = collidingCandidates.map(c => c.candidate.asset.uri);
  // Request mid + end frames only (first-frame pHash already obtained from pass 1)
  const remainingFrameTimes = collidingCandidates.map(c => {
    const [, ...rest] = getVideoFrameTimes(c.candidate.asset);
    return rest;
  });
  const signatures = await timed('deep.video-full-fingerprint.native-batch', () =>
    getNativeVideoFrameSignatures(collidingUris, remainingFrameTimes, (completedCount) => {
      onProgress?.(75 + Math.round((completedCount / candidates.length) * 25));
    })
  );

  const sigMap = new Map<string, string[]>();
  for (const sig of signatures) {
    sigMap.set(sig.uri, sig.frameHashes);
  }

  for (const { candidate, firstFramePHash } of collidingCandidates) {
    const remainingHashes = sigMap.get(candidate.asset.uri);
    if (remainingHashes && remainingHashes.length > 0) {
      // Combine pass-1 first-frame pHash + pass-2 mid/end pHashes
      recordFingerprint(candidate, [firstFramePHash, ...remainingHashes].join(':'));
    } else {
      // Fallback to JS path
      const fp = await timed('deep.video-fingerprint.total', () =>
        getVideoFingerprint(candidate.asset)
      );
      recordFingerprint(candidate, fp);
    }
  }
} else {
  // Existing JS fallback loop (unchanged)
  ...
}
```

**IMPORTANT — First-frame pHash reuse**: Pass 2 requests only the mid + end frames from the native module, then prepends the pass-1 first-frame pHash. No redundant first-frame extraction.

**NOTE**: `getVideoFirstFrameFingerprint` and `getVideoFingerprint` are kept as JS fallbacks for any URI that fails natively (corrupt file, unsupported codec, iCloud-only asset).

---

### Expected Speedup (Based on Real Profiler Data)

| Metric | Before | After (estimated) | Improvement |
|--------|--------|-------------------|-------------|
| Pass 1 per-video avg | 726 ms | ~50–100 ms | **7–15×** |
| Pass 1 total (351 videos) | 254.9s | ~18–35s | **7–14×** |
| Pass 2 per-video avg | 2,231 ms | ~100–200 ms | **11–22×** |
| Pass 2 total (14 videos) | 31.2s | ~1.4–2.8s | **11–22×** |
| **Video duplicates total** | **145.1s** | **~20–40s** | **~4–7×** |
| **Full scan total** | **~259s** | **~125–155s** | **~1.7–2.1×** |

After this optimization, **photo fingerprinting (81s / 94s)** becomes the dominant cost and the next optimization target. The video phase drops from 56% to ~15–25% of total scan time.

### Fingerprint Format Change

| | Before | After |
|---|--------|-------|
| Pass 1 (first-frame) | MD5 of PNG bytes | DCT pHash (64-bit hex) |
| Pass 2 (3-frame) | `md5_1:md5_2:md5_3` | `pHash1:pHash2:pHash3` |
| Uniqueness guarantee | Byte-exact (PNG-dependent) | Perceptual (resolution/codec-independent) |
| Cross-resolution matching | ❌ Misses re-encoded copies | ✅ Catches re-encoded copies |

---

### Open Questions

1. **`OPTION_CLOSEST_SYNC` vs `OPTION_CLOSEST`**: Sync-frame seeking is faster but may land on a slightly different frame than the exact 0.1s timestamp for videos with long GOP structures. For fingerprinting this should be fine (same video at different resolutions has the same sync frames), but worth validating on known duplicate pairs.

2. **`ph://` video resolution on iOS**: `AVAssetImageGenerator` needs a file URL, not a `ph://` identifier. Need a `resolveLocalVideoURL` helper using `PHAsset.requestContentEditingInput` with `isNetworkAccessAllowed = false`.

3. **Batch size tuning**: `VIDEO_BATCH_SIZE = 50` mirrors the photo path, but video frame extraction is heavier per-item. If memory pressure is observed on the S21, reduce to 25 or 10. The profiler will show if individual batches are too large.

---

## Implementation Status

### Android Implementation (Completed)
1. **Kotlin Native Module (`ThumbnailSignaturesModule.kt`)**: Added `AsyncFunction("getVideoFrameSignatures")` using Android's lightweight `MediaMetadataRetriever` with `OPTION_CLOSEST_SYNC` to extract frames natively without initializing heavy ExoPlayer/`expo-video` player instances.
2. **Native pHash Calculation**: Reused the static `COS_TABLE` and 64-bit DCT perceptual hash algorithm (32×32 luminance matrix downsampling) to compute pHashes directly in Kotlin background coroutines (`Dispatchers.IO`).
3. **TypeScript Module Wrapper (`modules/thumbnail-signatures/index.ts` & `nativeThumbnailSignatures.ts`)**: Added `getVideoFrameSignatures` bridge function and `getNativeVideoFrameSignatures` batch helper (batch size 50).
4. **Duplicate Detection Integration (`duplicateDetection.ts`)**:
   - **Pass 1**: Batch-dispatches candidate video URIs for native first-frame pHash computation wrapped under `deep.video-first-frame.native-batch`.
   - **Pass 2**: For first-frame collisions, batch-dispatches native requests for mid + end frames wrapped under `deep.video-full-fingerprint.native-batch` and prepends the Pass 1 pHash.
   - **Fallback**: Retains existing JS `expo-video` player path for URIs that fail native extraction.

### iOS Implementation (Completed)
1. **Swift Native Module (`ThumbnailSignaturesModule.swift`)**: Added matching `AsyncFunction("getVideoFrameSignatures")` using `AVFoundation` (`AVAssetImageGenerator`).
2. **`ph://` Asset Resolution**: Added `resolveVideoURL` helper using `PHImageManager.default().requestAVAsset` (`isNetworkAccessAllowed = false`) to resolve iOS Photo Library video assets to local file URLs.
3. **Native pHash & Multi-threading**: Uses `AVAssetImageGenerator` with `maximumSize = CGSize(128, 128)`, downsampling to 32×32 grayscale, and computing the identical 64-bit DCT perceptual hash in parallel across background queues via `DispatchQueue.global(qos: .userInitiated)` and `DispatchGroup`.

### Benchmarking Metrics
In dev builds (`__DEV__`), inspect `[ScanProfile]` log output for the following labels to verify native video execution:
- `deep.video-first-frame.native-batch`: Total time taken for native Pass 1 first-frame extraction & pHash computation.
- `deep.video-full-fingerprint.native-batch`: Total time taken for native Pass 2 mid+end frame extraction on colliding candidate videos.
- `deep.video-first-frame.total` / `deep.video-fingerprint.total`: Time spent in fallback JS path (should show 0 count if all videos succeed natively).


---

## Verification Plan

### Automated Tests
- Build the native modules: `npx expo prebuild`
- Run the app in dev mode on the S21 with profiler labels enabled
- Compare `deep.video-first-frame.*` and `deep.video-full-fingerprint.*` timings before and after
- Verify duplicate groups match (or are a strict superset of) the pre-optimization baseline

### Manual Verification
- Deep Scan the same library (6,718 assets, 517 videos, 351 candidates) on the S21
- Confirm scan completes without crashes or ANRs
- Verify progress bar updates smoothly during both video passes
- Test abort/cancel during video fingerprinting phase
- Spot-check known duplicate video pairs (same content, different resolutions/bitrates) are still detected
- Spot-check that non-duplicate videos with similar first frames are correctly distinguished by the 3-frame fingerprint

