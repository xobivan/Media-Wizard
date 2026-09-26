# Scanning and Duplicate Detection

## 1. Scan lifecycle

[`useScanOperation.ts`](../src/hooks/useScanOperation.ts) owns the scan.

When a scan starts it:

1. Clears the previous error.
2. Sets state to `scanning`.
3. Resets progress, duplicate groups, scanned assets, and duplicate savings.
4. Loads only the required Media Library asset types in pages of 100.
5. Counts photos, videos, and total assets.
6. Runs the selected duplicate detector only for requested duplicate types.
7. Finds large videos only when that category is requested.
8. Stores the results.
9. Sets progress to 100 and state to `complete`.

The scan uses a `scanCancelled` ref. Cancellation is checked before and after
each Media Library page, during duplicate progress updates, after duplicate
detection, and after large-video detection.

An internal `ScanAbortedError` stops the workflow without showing a scan error.
Other errors set `scanState` to `error` and populate `scanError`.

## 2. Scan categories

`ScanTarget` supports three independently selectable categories:

| Target | Media Library query | Work performed | Results tab |
| --- | --- | --- | --- |
| `photoDuplicates` | Photos | Duplicate detection for photos | Photos |
| `videoDuplicates` | Videos | Duplicate detection for videos | Videos |
| `largeVideos` | Videos | Large-video detection | Large files |

The Home screen permits any combination. `All` selects all three targets.
Users may deselect every target, but the Scan button remains disabled until one
is selected. This avoids a no-op scan and makes the disabled state explicit in
the UI.

When only photo duplicates are selected, no videos are loaded. When one or both
video-oriented targets are selected, videos are loaded once and shared by the
requested analyses. Expensive normalized-image work and video frame extraction
are therefore skipped whenever duplicate detection for that type was not
requested.

## 3. Scan benchmarks

Every completed development scan records elapsed time for the operations that
were selected and logs it to the JavaScript console as `[ScanProfile]`. The
output includes Media Library loading plus one row per requested analysis:

- `Fast scan · Picture duplicates` or `Deep scan · Picture duplicates`
- `Fast scan · Video duplicates` or `Deep scan · Video duplicates`
- `Large videos`

The benchmark uses `performance.now()` around each top-level operation. The
same output retains lower-level timings for later performance diagnosis and
optimization; it is not displayed to end users or collected in production
builds.

## 4. Scan modes

The Home screen selects one of two modes:

```text
fast -> findDuplicateGroupsLegacy
deep -> findDuplicateGroups
```

Both detectors use:

1. Cheap metadata pre-filtering.
2. More expensive fingerprinting only for candidate groups containing more
   than one asset.

This reduces unnecessary hashing, image work, and video decoding.

## 5. Fast scan: exact file matching

Implemented by
[`duplicateDetectionLegacy.ts`](../src/services/duplicateDetectionLegacy.ts).

### Candidate grouping

For every asset:

1. Resolve it with `getMediaFile`.
2. Read its file size.
3. Ignore files with no valid positive size.
4. Create a key:

```text
mediaType : fileSize : width : height : duration
```

Only assets with the same key are candidates for the expensive matching stage.

### Fingerprinting

For every candidate:

1. Resolve the local file.
2. Use the native file MD5 when available.
3. If MD5 is unavailable or reading fails, use:

```text

### Fingerprinting

For every candidate:

1. Resolve the local file.
2. Use the native file MD5 when available.
3. If MD5 is unavailable or reading fails, use:

```text
filename : size : duration : width : height
```

Assets with the same fingerprint become one duplicate group. Groups with fewer
than two assets are removed.

### Characteristics

- Faster than deep scan.
- Best for byte-for-byte identical files.
- Does not intentionally find visually identical photos that were resized or
  re-encoded.
- The metadata fallback is less authoritative than a content hash.

## 6. Deep scan: candidate grouping & native execution

Implemented by [`duplicateDetection.ts`](../src/services/duplicateDetection.ts).

### Candidate grouping

The first pass reads each file's size and uses:

For photos:

```text
photo : width : height : sizeBucket
```

A coarse logarithmic size bucket (`Math.floor(Math.log2(size))`) eliminates implausible candidate pairs while ensuring re-encoded images with nearby sizes remain candidate duplicates.

For videos:

```text
video : reduced aspect ratio : rounded duration
```

Unlike fast scan, exact file size is not part of the candidate key. Reducing an
aspect ratio (for example, `1920:1080` and `1280:720` both become `16:9`)
allows Deep Scan to compare differently encoded or resized videos that retain
the same framing and approximate duration.

### Event loop yielding & cancellation checks
During the metadata grouping phase, the scanner yields control to the JS event loop every 100 items (`await new Promise(r => setTimeout(r, 0))`). This keeps the main React Native UI thread responsive, ensures progress bar updates render smoothly and gradually, and allows user cancellation ("Abort Scan") to register instantly within milliseconds.

---

## 7. Deep photo matching: Native DCT pHash

Photo duplicate detection is powered by a local Expo native module ([`modules/thumbnail-signatures`](../modules/thumbnail-signatures)) implemented in Kotlin (Android) and Swift (iOS). Both implementations share the same algorithm and produce the same 64-bit pHash string for the same image.

### Pipeline & Native Execution
1. **Bulk Batching**: Candidate photo URIs are collected into bulk arrays and passed to `getNativePhotoSignatures` in 50-item batches, eliminating 5,400+ JS-to-Native bridge roundtrips.
2. **Native Hardware Downsampling**:
   - **Android**: `ContentResolver.loadThumbnail` for MediaStore (`content://`) URIs; `BitmapFactory.decodeFile` with `inSampleSize = 8` for `file://` URIs. Produces a 128×128 thumbnail without decoding the full 12–50 MP source.
   - **iOS**: `PHImageManager.requestImage(targetSize: 128×128, deliveryMode: .fastFormat)` for `ph://` Photo Library URIs; `UIImage` + `UIGraphicsImageRenderer` downsample for `file://` URIs.
3. **Pre-computed Cosine Lookup Table**: A static 8×32 `COS_TABLE` replaces live `cos()` trigonometric calls with instant array lookups. Identical formula on both platforms.
4. **Multi-Threaded Concurrency**:
   - **Android**: Kotlin `async(Dispatchers.IO)` coroutines inside `runBlocking` — parallelises across all CPU cores.
   - **iOS**: `DispatchQueue.global(qos: .userInitiated)` + `DispatchGroup` — equivalent parallelism on Apple hardware.
5. **64-bit DCT Perceptual Hash (pHash)**: The module reduces the thumbnail to a 32×32 luminance matrix (BT.601 weights) and computes a 64-bit Discrete Cosine Transform (DCT) pHash string using the top-left 8×8 AC coefficients thresholded by their median.

### Matching Behavior & Tradeoffs
- **Re-encode & Compression Detection**: Because pHash matches visual frequency structures (low-frequency luminance patterns) rather than exact PNG bytes, it successfully groups re-encoded JPEGs, social media downloads (WhatsApp/Instagram), and resized copies.
- **Boundary Tradeoff**: In rare cases, photos that are visually nearly identical (such as consecutive burst shots with minimal subject movement) may share the same 64-bit pHash key and be flagged as duplicates.

### Fallback
If the native module is unavailable or a file fails native decoding, `duplicateDetection.ts` falls back to `normalizedPhotoFingerprint` (`expo-image-manipulator` resize to 64×64 PNG MD5) or streaming file MD5 hashing so individual unsupported files never fail the scan.


## 8. Deep video matching: Native DCT pHash

Video duplicate detection is integrated into the local Expo native module ([`modules/thumbnail-signatures`](../modules/thumbnail-signatures)) in Kotlin (Android) and Swift (iOS).

### Pipeline & Native Execution
1. **Pass 1 (First-frame prefilter)**: Candidate video URIs are passed to `getNativeVideoFrameSignatures` to extract only the first frame timestamp (`0.1s`).
   - **Android**: Uses `MediaMetadataRetriever` with `OPTION_CLOSEST_SYNC`.
   - **iOS**: Resolves `ph://` URIs via `PHImageManager.default().requestAVAsset` and uses `AVAssetImageGenerator` capped at 128×128.
   - Computes a 64-bit DCT perceptual hash (pHash) directly in native background threads (`Dispatchers.IO` on Android, `DispatchQueue.global` on iOS).
2. **Pass 2 (Collisions only)**: Candidates with colliding first-frame pHashes trigger native extraction for remaining timestamps (middle and end of video).
3. **Fingerprint construction**: Combines hashes into `pHash1:pHash2:pHash3`. Videos with unique first frames skip Pass 2 entirely.














### Offloaded iCloud Video Handling & Poster Frame Extraction
- **Poster Frame Fallback**: For iOS video assets offloaded to iCloud storage, `requestAVAsset` fails when `isNetworkAccessAllowed = false`. The native Swift module automatically calls `requestPosterFrame`, which queries `PHImageManager` with `deliveryMode = .fastFormat` to extract the locally cached poster image without triggering a network download.
- **Pass 2 Skip for iCloud Assets**: Assets processed via cached poster frames return `isICloudOffloaded: true`. If an offloaded video collides in Pass 1, `duplicateDetection.ts` records the poster pHash directly and skips Pass 2 frame extraction to prevent unnecessary decodes or network calls.
- **Early Guard on Missing Local Files**: If an offloaded video fails native extraction and reaches JS fallbacks (`getVideoFirstFrameFingerprint` / `getVideoFingerprint`), the scanner detects that `file.uri` is an unresolved `ph://` reference and returns `null` immediately. This avoids allocating an `expo-video` player or waiting for 30-second timeouts.

### Video Fallback

If thumbnail generation or frame processing fails:

1. Try the source file MD5.
2. If that fails, use the asset metadata fallback.

The `finally` release is important because deep scans may create many native
decoder instances.

### Deep-scan characteristics

- More capable than fast scan for re-encoded or resized media.
- More CPU, memory, and I/O intensive.
- Compares sampled frames rather than every video byte.
- Two videos can theoretically match if sampled frames match while content
  differs between sample points.

## 9. Duplicate groups and original selection

A duplicate group contains:

- `mediaType`
- `assets`
- A fingerprint on each asset
- A measured file size on each asset

When displaying or deleting a group, the asset with the oldest
`creationTime` is treated as the original and kept. All other assets are
duplicates.

## 10. Deleting duplicates

[`useDuplicateCleanup.ts`](../src/hooks/useDuplicateCleanup.ts) shows a
confirmation dialog before calling `MediaLibrary.deleteAssetsAsync`.

After successful deletion it:

1. Calculates deleted bytes.
2. Adds them to `duplicateStorageSaved`.
3. Removes the deleted groups.
4. Updates photo, video, and total scan counts.
5. Shows a success alert.

If deletion fails, the group remains visible and an error alert is displayed.

## 11. Estimated savings

[`mediaSavings.ts`](../src/services/mediaSavings.ts) calculates:

```text
duplicate bytes that would be deleted
  + estimated savings for selected large videos
```

The value is displayed in the Results summary before cleanup begins.
