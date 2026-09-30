# MediaWizard Handoff

## Project overview

MediaWizard is an Expo SDK 57 React Native app for Android and iOS. It scans the user's photo and video library locally, detects duplicate media, identifies large videos, lets the user review and delete duplicate copies, and compresses selected large videos using the device's hardware encoder.

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

### Large-video results and compression

- Large videos are detected from actual file sizes.
- The current threshold is 200 MB, defined in `src/services/largeVideoDetection.ts`.
- Results show file name, size, and duration.
- Users can select individual videos or Select all.
- If no large videos exist a "No large videos found" card is shown and the compress button is hidden.
- Tapping **"Compress N videos"** (disabled when 0 are selected) opens a bottom sheet over the Results screen.

### Compression bottom sheet

- Slides up over the Results screen; the Results screen remains mounted underneath.
- Configurable options:
  - `Balanced`, `High quality`, or `Maximum savings` compression quality.
  - Keep original files or delete originals after verifying.
- Displays estimated storage savings in the sheet header.
- A single **Start compression** button starts the job; during compression it changes to **Cancel compression**.
- Live progress bar and "Compressing N of M · X%" label.
- Cancelling mid-compression shows a confirmation alert. On confirmation the compression signal is set, state resets, and the sheet closes.
- On completion the sheet shows a success state with the amount saved and a **Continue reviewing** button to dismiss.
- The sheet can be swiped down to dismiss (gesture is blocked while compressing).
- Tapping the scrim outside the sheet also dismisses it (blocked while compressing).
- After dismissal the user is back on the Results screen and can continue reviewing duplicates or compress again.

### Storage strategy for deletion

- When originals will be deleted, the app checks free storage before starting.
- If enough space is available all originals are deleted together at the end (one permission dialog).
- If space is insufficient each original is deleted immediately after its compressed copy is saved (one dialog per video; the user must be present).

### Done screen

- Reached via the **Done** button in the Results screen header.
- Combines bytes saved by duplicate deletion and bytes saved by compression.
- Returning Home resets compression state and clears the media-file URI cache.

## Architecture

### Main orchestration

- [App.tsx](./App.tsx) owns navigation, permissions, album selection, scan state, cancellation, result state, deletion, compression state, and storage totals. All compression props flow from App.tsx through ResultsScreen into CompressionBottomSheet.

### Screens

- [HomeScreen.tsx](./src/components/screens/HomeScreen.tsx): source selection, scan mode, permissions, and start scan.
- [ResultsScreen.tsx](./src/components/screens/ResultsScreen.tsx): result screen composition; owns compression bottom sheet visibility state.
- [CompressionBottomSheet.tsx](./src/components/screens/CompressionBottomSheet.tsx): modal bottom sheet for compression configuration, progress, and success/error state.
- [DoneScreen.tsx](./src/components/screens/DoneScreen.tsx): completion summary.

### Results components

- `src/components/results/ResultsHeader.tsx` — back button and optional "Done" button
- `src/components/results/ResultsScanState.tsx`
- `src/components/results/ResultsSummary.tsx`
- `src/components/results/ResultsTabs.tsx`
- `src/components/results/ResultsSections.tsx`

### Services

- [duplicateDetection.ts](./src/services/duplicateDetection.ts): deep photo normalization plus exact video hashing.
- [duplicateDetectionLegacy.ts](./src/services/duplicateDetectionLegacy.ts): preserved fast exact-file detector used by Fast scan.
- [largeVideoDetection.ts](./src/services/largeVideoDetection.ts): file-size threshold detection.
- [mediaAssetFile.ts](./src/services/mediaAssetFile.ts): Android direct URI handling and iOS local URI resolution with in-memory cache.

### Navigation states

```text
home -> results -> done
```

Compression is inline on the Results screen (bottom sheet). There is no separate cleanup screen.

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
- `react-native-compressor` for hardware video encoding.

Because `expo-image-manipulator` is a native module, any development client built before it was installed must be rebuilt:

```powershell
npx expo run:android
```

For iOS, use:

```bash
npx expo run:ios
```

The local `modules/thumbnail-signatures` module now contains both:

- `android/` — Kotlin implementation (`ThumbnailSignaturesModule.kt`).
- `ios/` — Swift implementation (`ThumbnailSignaturesModule.swift`).

Any development client built before the Swift file was added must be rebuilt with `npx expo run:ios`.

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

5. No automated test suite currently covers permissions, scan cancellation, duplicate grouping, deletion, or threshold boundaries.

## Validation

The last successful validation command was:

```powershell
npx tsc --noEmit
```

The Expo SDK 57 documentation was consulted for MediaLibrary, FileSystem, Crypto, and ImageManipulator APIs.
