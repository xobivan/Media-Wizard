# General Architecture

## 1. Application structure

### Root component

[`App.tsx`](../App.tsx) is the application coordinator. It:

- Instantiates the domain hooks.
- Connects callbacks between hooks when one operation affects another
  operation's state.
- Owns the selected Results tab and the "keep originals" choice.
- Chooses which screen to render.
- Passes state and event handlers to screen components.

The root component intentionally does not contain duplicate matching or
compression algorithms.

### Hooks

- [`useMediaPermissions.ts`](../src/hooks/useMediaPermissions.ts) manages
  photo/video permission state, refreshes it when the app returns from system
  Settings, and detects the Android deletion-permission strategy.
- [`useAlbumSelection.ts`](../src/hooks/useAlbumSelection.ts) manages the
  selected source: the entire library or one album.
- [`useLargeVideoSelection.ts`](../src/hooks/useLargeVideoSelection.ts)
  stores detected large videos, selected IDs, and estimated selected savings.
- [`useScanOperation.ts`](../src/hooks/useScanOperation.ts) runs the library
  scan and coordinates duplicate and large-video detection.
- [`useCompressionOperation.ts`](../src/hooks/useCompressionOperation.ts)
  manages compression state and runs compression/deletion.
- [`useDuplicateCleanup.ts`](../src/hooks/useDuplicateCleanup.ts) handles
  duplicate deletion dialogs, Media Library deletion, and alerts.
- [`useAppNavigation.ts`](../src/hooks/useAppNavigation.ts) owns screen
  navigation and Android hardware-back behavior.

### Services & Local Native Modules

- [`duplicateDetection.ts`](../src/services/duplicateDetection.ts) implements
  deep duplicate detection, coordinating native DCT pHash thumbnail signatures and JS fallbacks.
- [`modules/thumbnail-signatures`](../modules/thumbnail-signatures) local Android Expo native module providing hardware-downsampled thumbnails and 64-bit DCT perceptual hash (pHash) generation.
- [`nativeThumbnailSignatures.ts`](../src/services/nativeThumbnailSignatures.ts) TypeScript interface layer for batching thumbnail signature calls to the native Kotlin module.
- [`duplicateDetectionLegacy.ts`](../src/services/duplicateDetectionLegacy.ts)
  implements fast/exact duplicate detection.
- [`largeVideoDetection.ts`](../src/services/largeVideoDetection.ts)
  identifies videos above the large-file threshold.
- [`smartCompression.ts`](../src/services/smartCompression.ts) creates
  compression plans, chooses a storage strategy, and performs compression.
- [`mediaSavings.ts`](../src/services/mediaSavings.ts) calculates the
  estimated savings shown in Results.
- [`mediaAssetFile.ts`](../src/services/mediaAssetFile.ts) resolves a Media
  Library asset to a local file representation.

### Screens and presentation components

- [`HomeScreen.tsx`](../src/components/screens/HomeScreen.tsx) selects the
  source, scan depth, independent scan categories, and permissions.
- [`ResultsScreen.tsx`](../src/components/screens/ResultsScreen.tsx) displays
  scan progress/errors, summaries, duplicate groups, and large videos.
- [`CleanupScreen.tsx`](../src/components/screens/CleanupScreen.tsx)
  configures compression and displays progress.
- [`DoneScreen.tsx`](../src/components/screens/DoneScreen.tsx) displays the
  final storage-saved total.
- Components under
  [`src/components/results/`](../src/components/results/) split Results into
  its header, scan state, summary, tabs, and result sections.

## 2. Screen workflow

The navigation states are:

```text
home -> results -> cleanup -> done
```

### Home

The user can:

- Choose the entire library.
- Open the album picker and choose an album.
- Choose `fast` or `deep` scan mode.
- Choose any combination of `Picture duplicates`, `Video duplicates`, and
  `Large videos`, or use `All` to select every category.
- Deselect all categories if desired. Scanning is disabled and the button
  visibly changes to "Choose what to scan" until at least one is selected.
- When media permission is denied, use `Allow` to open system Settings.
  Permission status is refreshed after returning to the app.
- Start a scan once access and at least one category are selected.

`HomeScreen` is presentational. Its callbacks are implemented by hooks or by
thin orchestration functions in `App.tsx`.

### Results

Starting a scan moves to Results immediately. While scanning:

- The header shows progress.
- The user can abort the scan.
- Confirmed abort discards partial results.

After a successful scan:

- The summary shows counts for the media types that were scanned.
- Only tabs for selected categories are visible: Photos for picture duplicates,
  Videos for video duplicates, and Large files for large videos.

The user can delete duplicate groups or continue to compression setup.

### Cleanup

The user chooses:

- `balanced`, `high`, or `maximum_savings` compression quality.
- Whether to keep original files.

The screen displays estimated savings, selected videos, progress, cancellation,
completion, and errors.

### Done

The Done screen combines:

- Bytes saved by compression.
- Bytes saved by duplicate deletion.

Returning Home resets compression state. A new scan also resets compression
state before showing new Results.

## 3. Main data flow

### Permissions and source selection

`useMediaPermissions` starts in `checking`, queries
`MediaLibrary.getPermissionsAsync`, and maps the result to `granted`, `limited`,
or `denied`. It repeats this query whenever the app becomes active, which keeps
the UI in sync after the user changes the permission in system Settings. It also
determines the platform deletion strategy.

`useAlbumSelection` maintains:

- `source`
- `selectedAlbum`
- `albums`
- `albumPickerVisible`

A null `selectedAlbum` means the entire library. A selected album is passed to
the scan.

### Scan output

`useScanOperation` maintains:

- `scanState`
- `scanError`
- `scanProgress`
- `scanTargets`
- `scannedAssets`
- `scanSummary`
- `duplicateGroups`
- `duplicateStorageSaved`

`scannedAssets` remains available because compression later needs to resolve
selected large-video IDs back to Media Library assets.

`scanTargets` is a composable list of `photoDuplicates`, `videoDuplicates`, and
`largeVideos`. `App.tsx` uses it to select the first applicable Results tab at
scan start and to limit the tabs exposed on Results.


### Cross-hook callback boundaries

```text
useScanOperation
  -> detected LargeVideo[] -> useLargeVideoSelection state

useCompressionOperation
  -> deleted asset IDs -> App.tsx updates scan and selection state

useDuplicateCleanup
  -> deleted groups/assets -> App.tsx updates duplicate and scan state

useAppNavigation
  -> navigation callbacks -> App.tsx resets operation state when needed
```

## 4. App.tsx responsibilities

The remaining logic in [`App.tsx`](../App.tsx) is intentionally orchestration:

- Start a scan and navigate to Results.
- Confirm or abort a scan.
- Pass selected videos and scanned assets into compression.
- Remove deleted compressed originals from related state.
- Select the appropriate screen.
- Pass props and event callbacks to screen components.

Moving the remaining JSX routing to another file would mostly move code without
improving domain separation.
