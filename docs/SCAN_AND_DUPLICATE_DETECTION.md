# Scanning and Duplicate Detection

## 1. Scan lifecycle

[`useScanOperation.ts`](../src/hooks/useScanOperation.ts) owns the scan.

When a scan starts it:

1. Clears the previous error.
2. Sets state to `scanning`.
3. Resets progress, duplicate groups, scanned assets, and duplicate savings.
4. Loads Media Library assets in pages of 100.
5. Counts photos, videos, and total assets.
6. Runs the selected duplicate detector.
7. Finds large videos.
8. Stores the results.
9. Sets progress to 100 and state to `complete`.

The scan uses a `scanCancelled` ref. Cancellation is checked before and after
each Media Library page, during duplicate progress updates, after duplicate
detection, and after large-video detection.

An internal `ScanAbortedError` stops the workflow without showing a scan error.
Other errors set `scanState` to `error` and populate `scanError`.

## 2. Scan modes

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

## 3. Fast scan: exact file matching

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

## 4. Deep scan: normalized fingerprints

Implemented by
[`duplicateDetection.ts`](../src/services/duplicateDetection.ts).

### Candidate grouping

The first pass reads each file's size and uses:

For photos:

```text
photo : width : height
```

For videos:

```text
video : width : height : rounded duration
```

Unlike fast scan, file size is not part of the candidate key. This allows deep
scan to compare differently encoded or resized files with matching dimensions
and approximate duration.

## 5. Deep photo matching

For every candidate photo:

1. Resolve the source file.
2. Resize it to 64 x 64 with `expo-image-manipulator`.
3. Render and save the normalized image as PNG.
4. Use the normalized file's MD5, or SHA-256 of its Base64 content.
5. Group photos with the same normalized fingerprint.
6. Delete the temporary normalized file.

Normalization reduces the effect of source resolution and encoding differences.
It is intended to find visually equivalent photos that do not have identical
source bytes.

If image manipulation fails:

1. Try the source file MD5.
2. If that fails, use:

```text
filename : duration : width : height
```

This fallback keeps one unsupported image from aborting the whole scan, but it
is less reliable than normalized content matching.

## 6. Deep video matching

For every candidate video:

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

## 7. Duplicate groups and original selection

A duplicate group contains:

- `mediaType`
- `assets`
- A fingerprint on each asset
- A measured file size on each asset

When displaying or deleting a group, the asset with the oldest
`creationTime` is treated as the original and kept. All other assets are
duplicates.

## 8. Deleting duplicates

[`useDuplicateCleanup.ts`](../src/hooks/useDuplicateCleanup.ts) shows a
confirmation dialog before calling `MediaLibrary.deleteAssetsAsync`.

After successful deletion it:

1. Calculates deleted bytes.
2. Adds them to `duplicateStorageSaved`.
3. Removes the deleted groups.
4. Updates photo, video, and total scan counts.
5. Shows a success alert.

If deletion fails, the group remains visible and an error alert is displayed.

## 9. Estimated savings

[`mediaSavings.ts`](../src/services/mediaSavings.ts) calculates:

```text
duplicate bytes that would be deleted
  + estimated savings for selected large videos
```

The value is displayed in the Results summary before cleanup begins.
