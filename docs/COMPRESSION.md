# Video Compression

## 1. Compression responsibilities

Compression is split across:

- [`App.tsx`](../App.tsx): connects selected videos, scanned assets, navigation,
  and cross-hook state updates.
- [`useCompressionOperation.ts`](../src/hooks/useCompressionOperation.ts):
  owns compression state and the workflow.
- [`smartCompression.ts`](../src/services/smartCompression.ts): creates
  compression plans, chooses storage behavior, runs the native encoder, and
  verifies output.
- [`largeVideoDetection.ts`](../src/services/largeVideoDetection.ts):
  identifies large videos and creates initial savings estimates.

## 2. Large-video detection

[`findLargeVideos`](../src/services/largeVideoDetection.ts) filters scanned
assets to videos and reads each file size.

The threshold is:

```text
200 * 1024 * 1024 bytes
```

Each qualifying video becomes a `LargeVideo` record containing:

- Media Library ID
- Filename
- Display size and duration
- Original size
- Estimated output size
- Estimated savings in megabytes
- Whether compression should be allowed

The initial estimate assumes 1920 x 1080, 30 FPS, and audio enabled. Actual
source metadata is read again during compression.

## 3. Preparing compression

Before Results navigates to Cleanup, `App.tsx` calls `prepareCompression()`.
This resets:

- State to `idle`
- Progress to zero
- Current video index to zero
- Previous compression error

It does not clear the previously reported storage-saved value. A full reset
does clear that value.

The selected quality is:

- `balanced`
- `high`
- `maximum_savings`

`keepOriginals` is converted to `deleteOriginals = !keepOriginals`.

## 4. Compression planning

`compressVideo` first reads source metadata using
`react-native-compressor.getVideoMetaData`.

The plan includes:

- Source and target bitrate
- Output dimensions
- Output frame rate
- Estimated output size
- Estimated savings
- Whether the operation should be skipped

Bitrate multipliers are:

| Quality | Multiplier |
| --- | ---: |
| Balanced | `0.52` |
| High | `0.72` |
| Maximum savings | `0.38` |

For maximum savings:

- 4K-or-larger width is reduced to 1920.
- Frame rates above 30 FPS are capped at 30.

Compression is considered not worthwhile when estimated savings are less than
both 10 MB and 8% of the original file size.

## 5. Storage strategy

When originals will be deleted, the hook calls:

1. `getDeviceStorageInfo()`
2. `determineStorageStrategy()`

The estimate is:

```text
all original sizes
  + all estimated compressed sizes
  + 500 MB temporary-file buffer
```

### Enough free space

If enough space is available:

- Originals remain until every selected video is compressed.
- Originals are deleted together at the end.
- The user sees one deletion permission dialog where supported.

### Not enough free space

If space is insufficient:

- `deleteImmediately` becomes true.
- Each original is deleted after its compressed replacement is saved.
- Space is freed before the next video.
- The user is warned that interaction may be required for each deletion.

The strategy is shown in a confirmation dialog before compression starts.

## 6. Concurrent Batch Workflow

`performCompression` processes videos in **concurrent batches** (default `BATCH_SIZE = 2`) via `Promise.all`. This maximizes hardware encoder throughput without crossing into thermal throttling or Out-Of-Memory (OOM) crashes, providing a ~20-25% speedup over strict sequential processing.

For each batch:

1. Check the cancellation signal.
2. Wait 300ms between batches to allow OS-level cleanup.
3. Simultaneously for each video in the chunk:
   1. Find the corresponding scanned Media Library asset.
   2. Resolve its local input URI with `getMediaFile`.
   3. Call `compressVideo`.
   4. Save the result with `MediaLibrary.createAssetAsync`.
   5. Delete the temporary output file.
   6. Delete the original immediately or queue it for batch deletion.
   7. Add input size minus output size to the saved-byte total.

Aggregate progress is calculated by tracking an array of fractional completion percentages for all selected videos and summing them for smooth UI rendering. Performance is also tracked via the internal `compressionProfiler`.

## 7. Native encoding

The service calls `Video.compress` with:

- `compressionMethod: 'manual'`
- The calculated target bitrate
- `maxSize` explicitly set to the longest edge of the video (forced to an even number to prevent Android `MediaCodec` crashes on portrait videos).
- A cancellation ID captured from the compressor

## 8. Output verification

An encoded file is not accepted immediately. The service:

1. Requires a non-empty output URI.
2. Polls up to five times until the file exists and has positive size.
3. Reads output metadata.
4. Deletes and rejects unreadable output.
5. Rejects output shorter than 90% of source duration.
6. Rejects output that is not smaller than the original.

When verification fails, the original is preserved and that video is reported
as a compression failure.

## 9. Cancellation

The **Cancel compression** button is shown in the bottom sheet while compression is running (it replaces the Start compression button). Tapping it shows a confirmation alert before acting.

On confirmation, `cancelCompression` sets a mutable cancellation signal. The signal is:

- Checked between videos.
- Passed to `compressVideo`.
- Checked during native progress callbacks.

When set during encoding, `Video.cancelCompression` is called using the native
cancellation ID.

After cancellation:

- Already-created compressed videos remain in the Media Library.
- Pending originals are not batch-deleted.
- Compression state resets to `idle` via `prepareCompression()`.
- The bottom sheet closes and the user is returned to the Results screen.

## 10. Original deletion and state updates

After successful original deletion, IDs are sent back to `App.tsx`. The app
removes them from:

- `largeVideos`
- `selectedLarge`
- `scannedAssets`
- Scan summary video and total counts

Deletion permission failures are reported, but a successfully created
compressed video is not discarded.

Final compression states are:

- `complete`: all selected videos succeeded.
- `error`: one or more videos failed.
- `idle` with a cancellation message: user cancelled.

## 11. Failure guarantees

The compression workflow is designed to preserve originals when:

- The source is missing.
- The source cannot be decoded.
- Encoding fails.
- Output is unreadable.
- Output loses significant duration.
- Output is not smaller than the source.
- Original deletion permission is denied.

Temporary-file deletion failures are logged separately and do not invalidate a
verified Media Library asset.

## 12. Media-file URI cache

`mediaAssetFile.ts` maintains an in-memory `Map` from asset ID to resolved`File` on iOS (on Android the URI is used directly and nothing is cached).

The cache is cleared in two situations:

- At the end of `performCompression` (success or error path), so stale URIs do not accumulate across repeated compressions in the same session.
- In `resetCompressionState()`, which is called when the user leaves the Done screen back to Home, or when a scan is aborted. This guarantees the cache is empty before any new scan, regardless of whether compression ran, was cancelled, or never started.
