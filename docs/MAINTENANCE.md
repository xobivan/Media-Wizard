# Maintenance Guide

## 1. Where to make changes

### Scanning behavior

Change [`useScanOperation.ts`](../src/hooks/useScanOperation.ts) for scan
lifecycle, cancellation, progress, and scan state changes.

Change the appropriate duplicate detector for matching behavior:

- [`duplicateDetectionLegacy.ts`](../src/services/duplicateDetectionLegacy.ts)
  for fast scan.
- [`duplicateDetection.ts`](../src/services/duplicateDetection.ts) for deep
  scan.

Keep `scannedAssets` available if later workflows need original asset IDs.

### Duplicate matching

If the user-visible duplicate contract changes, update both fast and deep
implementations where appropriate. Preserve candidate pre-filtering unless a
deliberate performance tradeoff is intended.

Any temporary normalized image must be deleted. Any native video player must
be released even when thumbnail generation fails.

### Compression

Change [`smartCompression.ts`](../src/services/smartCompression.ts) for
quality calculations, bitrate planning, native encoding, or output validation.

Change [`useCompressionOperation.ts`](../src/hooks/useCompressionOperation.ts)
for compression state, cancellation, deletion sequencing, and alerts.

Keep output verification before accepting a compressed file. Preserve
sequential processing unless memory behavior is re-evaluated.

### Screens

Add presentation behavior to the relevant screen component. Keep domain
algorithms out of screen components.

Cross-screen state transitions belong in `App.tsx` or a related hook.

## 2. Error and fallback behavior

Important existing fallbacks include:

- Permission status is explicit: checking, granted, limited, or denied.
- Duplicate fingerprinting falls back to file hashes or metadata when decoding
  fails.
- Native video players are released in `finally`.
- Compression failures preserve originals.
- Temporary-file cleanup failures are logged without invalidating verified
  output.
- Failed Media Library deletion leaves failed items in app state and shows an
  alert.
- Scan cancellation is a normal user action, not a scan error.

Do not replace these with silent success-shaped fallbacks.

## 3. State ownership

Keep state with the hook that owns the domain:

| State | Owner |
| --- | --- |
| Permission status | `useMediaPermissions` |
| Album selection | `useAlbumSelection` |
| Large-video selection | `useLargeVideoSelection` |
| Scan results and summary | `useScanOperation` |
| Compression state | `useCompressionOperation` |
| Duplicate deletion actions | `useDuplicateCleanup` |
| Screen and back navigation | `useAppNavigation` |
| Selected tab and keep-originals option | `App.tsx` |

Callbacks are used when one workflow must update another hook's state.

## 4. Architectural boundary

`App.tsx` is intentionally a coordinator. It still contains a small amount of
orchestration because independent workflows meet there:

- Scan completion navigates to Results.
- Compression deletion updates scan and selection state.
- Duplicate deletion updates scan summary state.
- Screen transitions determine which controls are visible.

Do not create a single master hook combining permissions, albums, scanning,
compression, duplicates, and navigation. The separate hooks are easier to
understand and test.

Likewise, moving all JSX routing into another component would mostly reduce
the line count without improving domain separation.

## 5. Practical change checklist

Before changing a workflow:

1. Identify the owning hook or service.
2. Check which state is shared through callbacks.
3. Preserve cancellation and error behavior.
4. Preserve original-file safety guarantees.
5. Run the existing TypeScript check:

```powershell
npx tsc --noEmit
```

6. Test the affected user flow on a device, especially Media Library
   permission and deletion behavior.

## 6. Current type conventions

Use the existing shared types from
[`mediaWizardTypes.ts`](../src/components/types/mediaWizardTypes.ts), especially
`LargeVideo`, `ScanState`, `ScanMode`, `ScanSummary`, and `ResultTab`.

Avoid reintroducing `any` into hook APIs. Prefer a shared domain type or a
focused `Pick<...>` type.
