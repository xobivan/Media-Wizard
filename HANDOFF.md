# MediaWizard Handoff

## Project overview

MediaWizard is an Expo SDK 57 React Native app for Android and iOS. It scans the user's photo and video library locally, detects duplicate media, identifies large videos, lets the user review and delete duplicate copies, and prepares selected large videos for compression.

The project is located at `E:\MediaWizard`.

## Current functionality

### Library source selection

- Scan the entire media library.
- Choose a device album.
- Album selection is shown and highlighted correctly.
- Selecting the entire library closes the album picker.
- The album picker does not show a redundant Cancel action.

### Permissions

- Requests photo and video access through `expo-media-library/legacy`.
- Handles checking, granted, limited, and denied states.
- Provides an Android/iOS settings link when access is denied.
- Requests only photo and video permissions, not audio.
- Android media scanning avoids unnecessary EXIF location access.

### Scanning

- Reads media in pages using `MediaLibrary.getAssetsAsync`.
- Displays scan progress and photo/video/total counts.
- Supports retry after a scan error.
- Supports two scan modes:
  - **Fast scan:** exact file-content matching using SHA-256.
  - **Deep scan:** normalizes photos to 64x64 PNGs before hashing to find identical images with different encoding/compression.
- Deep scan falls back to exact byte hashing when an image cannot be decoded by `expo-image-manipulator`, so one malformed or unsupported image does not abort the entire scan.
- Scans can be aborted:
  - Back during scanning shows Continue scan / Abort scan.
  - An explicit Abort scan button is shown under the progress bar.
  - Aborting discards partial results and returns to the home screen.
- The scan UI explains that large libraries and large videos can take additional time.

### Duplicate results

- Real duplicate groups are shown for photos and videos.
- Duplicate groups are expandable.
- Each group displays:
  - Number of copies.
  - File names.
  - Preview thumbnails for photos.
  - Video preview placeholders.
  - Which asset is the oldest original.
  - Which assets will be deleted.
- The oldest asset in each group is preserved as the original.
- Each group has a Delete duplicates action.
- Each Photos/Videos results section has a Delete all duplicates action.
- Deletion requires confirmation.
- Deletion uses `MediaLibrary.deleteAssetsAsync`.
- Deletion errors are shown to the user.
- After successful deletion:
  - Duplicate groups disappear.
  - Media counts update.
  - Storage saved is calculated from the deleted assets' actual byte sizes.
  - A storage-saved alert is displayed.

### Large-video results

- Large videos are detected from actual file sizes.
- The current threshold is 200 MB, defined in `src/services/largeVideoDetection.ts`.
- Results show file name, size, and duration.
- Users can select individual videos.
- Users can Select all when large videos exist.
- If no large videos exist:
  - Select all is hidden.
  - Continue to cleanup is hidden.
  - A No large videos found message is shown.

### Cleanup and completion UI

- Users can review selected large videos.
- Users can choose:
  - Keep original files.
  - Delete originals after verifying compression.
- A thermal/battery-conscious processing message is shown.
- Completion screen shows storage saved from duplicate deletion plus the current compression estimate.
- The current compression action is still a UI placeholder; it does not perform real video compression.

## Architecture

### Main orchestration

- [App.tsx](./App.tsx) owns navigation, permissions, album selection, scan state, cancellation, result state, deletion, and storage totals.

### Screens

- [HomeScreen.tsx](./src/components/screens/HomeScreen.tsx): source selection, scan mode, permissions, and start scan.
- [ResultsScreen.tsx](./src/components/screens/ResultsScreen.tsx): result screen composition.
- [CleanupScreen.tsx](./src/components/screens/CleanupScreen.tsx): selected video cleanup options.
- [DoneScreen.tsx](./src/components/screens/DoneScreen.tsx): completion summary.

### Results components

- `src/components/results/ResultsHeader.tsx`
- `src/components/results/ResultsScanState.tsx`
- `src/components/results/ResultsSummary.tsx`
- `src/components/results/ResultsTabs.tsx`
- `src/components/results/ResultsSections.tsx`

### Services

- [duplicateDetection.ts](./src/services/duplicateDetection.ts): deep photo normalization plus exact video hashing.
- [duplicateDetectionLegacy.ts](./src/services/duplicateDetectionLegacy.ts): preserved fast exact-file detector used by Fast scan.
- [largeVideoDetection.ts](./src/services/largeVideoDetection.ts): file-size threshold detection.
- [mediaAssetFile.ts](./src/services/mediaAssetFile.ts): Android direct URI handling and iOS local URI resolution.

### Shared code

- `src/components/types/mediaWizardTypes.ts`: shared UI and scan types.
- `src/components/styles/mediaWizardStyles.ts`: shared styles.
- `src/components/MediaCard.tsx`: reusable media row.

## Dependencies

The app uses:

- Expo SDK 57.
- React Native 0.86.
- `expo-media-library` legacy API.
- `expo-file-system`.
- `expo-crypto`.
- `expo-image-manipulator`.
- `react-native-safe-area-context`.

Because `expo-image-manipulator` is a native module, any development client built before it was installed must be rebuilt:

```powershell
npx expo run:android
```

For iOS, use:

```bash
npx expo run:ios
```

## Known limitations

1. Deep scan is expensive.
   - It renders and saves a temporary normalized image for each candidate photo.
   - Video hashing currently reads complete files as Base64.
   - This can consume memory, battery, and time on large libraries.
   - A future implementation should use sampled/chunked hashing or native streaming hashes.

2. Deep matching is not a general perceptual similarity detector.
   - It compares normalized image output exactly.
   - Different images that become identical after aggressive downscaling are theoretically possible.
   - It should be replaced with a carefully tuned perceptual hash/similarity threshold if near-duplicate detection is required.

3. `expo-image-manipulator` must be present in the native development client.
   - JavaScript installation alone is not enough.
   - A stale client reports `Cannot find native module 'ExpoImageManipulator'`.

4. Large-video detection only identifies files larger than 200 MB.
   - The threshold is currently hardcoded.
   - There is no user-configurable threshold yet.

5. Compression is not implemented.
   - The cleanup screen describes efficient encoding and thermal safeguards, but no encoder is connected.
   - Original deletion is not connected to a real compression result.

6. Storage savings from compression are estimates.
   - Duplicate deletion savings use actual deleted file sizes.
   - Compression savings still use the existing estimate field and should be replaced with actual output size differences.

7. No automated test suite currently covers permissions, scan cancellation, duplicate grouping, deletion, or threshold boundaries.

## Next implementation milestone

The next major bullet point is **real mobile video compression**:

1. Select an encoder approach that works on Android and iOS.
2. Prefer hardware/native codecs where available.
3. Process one video at a time to limit memory, heat, and battery usage.
4. Add progress and cancellation for compression.
5. Pause or stop when the device is too hot or battery is low, using platform APIs where available.
6. Write compressed output to a temporary location first.
7. Verify the output before deleting the original.
8. Respect the user's Keep original files / Delete originals after verifying choice.
9. Calculate actual storage saved from original size minus compressed output size.
10. Surface failures per file without losing completed results.

## Recommended follow-up work before compression

- Rebuild and test the current app on a physical Android device after installing `expo-image-manipulator`.
- Test Fast and Deep scan modes with:
  - Exact copied files.
  - Screenshots saved with different compression.
  - Similar but different photos.
  - Unsupported or cloud-only assets.
  - Large libraries.
- Optimize hashing before production use.
- Consider moving scan and deletion orchestration out of `App.tsx` into services/hooks as the feature set grows.
- Add tests for duplicate counts, oldest-original selection, bulk deletion, storage calculations, and scan cancellation.

## Validation

The last successful validation command was:

```powershell
npx tsc --noEmit
```

The Expo SDK 57 documentation was consulted for MediaLibrary, FileSystem, Crypto, and ImageManipulator APIs.
