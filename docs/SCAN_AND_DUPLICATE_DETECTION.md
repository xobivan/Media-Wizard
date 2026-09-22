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

Photo duplicate detection is powered by an Android local Expo native module ([`modules/thumbnail-signatures`](../modules/thumbnail-signatures)).

### Pipeline & Native Execution
1. **Bulk Batching**: Candidate photo URIs are collected into bulk arrays and passed to `getNativePhotoSignatures` in 50-item batches, eliminating 5,400+ JS-to-Native bridge roundtrips.
2. **Native Hardware Downsampling**: The native module decodes thumbnails at $128 \times 128$ via `ContentResolver.loadThumbnail` for MediaStore URIs or fast `BitmapFactory.decodeFile` with `inSampleSize = 8` for `file://` URIs, preventing full 12–50MP images from bloating RAM.
3. **Pre-computed Cosine Lookup Table**: A static $8 \times 32$ `COS_TABLE` replaces live `Math.cos()` trigonometric calls with instant array lookups.
4. **Multi-Threaded Coroutines (`Dispatchers.IO`)**: Thumbnail decoding and pHash generation run concurrently across all CPU cores on the device using Kotlin coroutines (`runBlocking` + `async(Dispatchers.IO)`).
5. **64-bit DCT Perceptual Hash (pHash)**: The module reduces the thumbnail to a 32x32 luminance matrix and computes a 64-bit Discrete Cosine Transform (DCT) pHash string.

### Matching Behavior & Tradeoffs
- **Re-encode & Compression Detection**: Because pHash matches visual frequency structures (low-frequency luminance patterns) rather than exact PNG bytes, it successfully groups re-encoded JPEGs, social media downloads (WhatsApp/Instagram), and resized copies.
- **Boundary Tradeoff**: In rare cases, photos that are visually nearly identical (such as consecutive burst shots with minimal subject movement) may share the same 64-bit pHash key and be flagged as duplicates.

### Fallback
If the native module is unavailable or a file fails native decoding, `duplicateDetection.ts` falls back to `normalizedPhotoFingerprint` (`expo-image-manipulator` resize to 64x64 PNG MD5) or streaming file MD5 hashing so individual unsupported files never fail the scan.

## 8. Deep video matching

1. Resolve the source file.
2. Create an `expo-video` player.
3. Choose up to three timestamps:
   - `0.1` seconds
   - Middle of the video
   - `duration - 0.1` seconds
4. Generate thumbnails at those timestamps, capped at 64 x 64.
5. Normalize each thumbnail to PNG.
6. Hash each thumbnail with MD5 or SHA-256.
7. Join the frame hashes with `:` to form one video fingerprint.
8. Release the native player in `finally`.

Videos with the same sequence of sampled frame hashes become one group.

### Video fallback

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
