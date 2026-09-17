# Deep Scan Optimization — Handoff

## Status

Baseline profiling exists (see "Baseline results" below) and one change has
since been implemented on top of it: bounded concurrency (2) for photo
fingerprinting (idea #5). Everything else in the original proposal — the
matching criteria, the fingerprint algorithm itself, and video fingerprinting
(which remains serial) — is unchanged. Do not skip straight to implementing
further optimizations from the table below without re-profiling first.

## Baseline results (before photo-fingerprint concurrency)

Measured on a 6,693-item library (Samsung S21):

- Total Deep Scan time: 32m 42s.
- `deep.photo-fingerprint.total`: 5,502 photos, 17m 26s total, ~190 ms
  average each — the largest single bottleneck.
- `deep.video-fingerprint.total`: 13m 57s total. Out of scope for this
  change; not modified.

## Implemented: bounded concurrency for photo fingerprinting

[`duplicateDetection.ts`](../src/services/duplicateDetection.ts) now runs up
to 2 photo fingerprint jobs (`getPhotoFingerprint`, i.e. resize → render →
PNG save → hash → temp-file delete) concurrently instead of one at a time.
Video fingerprinting (`getVideoFingerprint`) is unchanged and still runs
strictly serially — the loop drains all in-flight photo work before starting
a video job, so a video's native decoder/player never overlaps with
concurrent photo rendering. Progress reporting, cancellation (via the
`onProgress` callback throwing), the ImageManipulator-failure fallback to
streaming file hashing, and temp-file cleanup are all preserved; each
in-flight promise is drained (via `Promise.allSettled`) before an error or
cancellation propagates, so no unhandled rejections are left behind.

Grouping and the fingerprint algorithm itself are unchanged, so the set of
duplicate groups produced for a fixed library is expected to be identical to
before — only the wall-clock time and internal ordering of same-fingerprint
group members can differ.

**Re-run the same benchmark on the same library/device to confirm before/after
`deep.photo-fingerprint.total` and total Deep Scan time, and to check for any
memory/stability regression on low-end devices.** If concurrency 2 regresses
stability or shows no material improvement, revert it and record the result
here.

## Context

The original proposal is at
[`DEEP_SCAN_OPTIMIZATION_PROPOSAL.md`](../../../downloads/DEEP_SCAN_OPTIMIZATION_PROPOSAL.md)
(outside the repo, `e:\downloads\`). It was written as a review document for
engineering agents — it explicitly says "do not implement automatically,
validate assumptions first." That instruction still applies.

Deep Scan is reported as slow on a Samsung S21 (10+ minutes on a real
library). The goal is to reduce Deep Scan latency **without** reducing its
detection scope to what Fast Scan already covers (byte-identical files).

## Relevant code

- [`useScanOperation.ts`](../src/hooks/useScanOperation.ts) — owns the scan
  lifecycle: paginated Media Library load → duplicate detection → large-video
  detection → results.
- [`duplicateDetection.ts`](../src/services/duplicateDetection.ts) — Deep
  Scan implementation (`findDuplicateGroups`). Two phases:
  1. Metadata grouping (`photo:width:height` or
     `video:width:height:roundedDuration`) — cheap.
  2. Fingerprinting of candidate groups (`>1` member) — expensive:
     - Photos: `expo-image-manipulator` resize to 64×64 → PNG →
       `File.md5` (or SHA-256 fallback) → delete temp file.
     - Videos: `createVideoPlayer` (expo-video) → up to 3
       `generateThumbnailsAsync` calls (0.1s, mid, end-0.1s) → each thumbnail
       normalized through `ImageManipulator` → PNG → hash → delete →
       `player.release()`.
- [`duplicateDetectionLegacy.ts`](../src/services/duplicateDetectionLegacy.ts)
  — Fast Scan (`findDuplicateGroupsLegacy`), uses `mediaType:size:width:height:duration`
  as the candidate key plus native file MD5. Not in scope for this
  optimization work except as the behavioral boundary Deep Scan must not
  collapse into.
- [`SCAN_AND_DUPLICATE_DETECTION.md`](./SCAN_AND_DUPLICATE_DETECTION.md) —
  existing architecture doc for both scan modes.

## Proposal review summary

The proposal's ideas, in priority order, with my assessment:

| # | Idea | Assessment |
|---|------|------------|
| 1 | Instrument/benchmark first | **Required before anything else.** No profiling exists in the code today. |
| 2 | Eliminate temp PNG file I/O (in-memory fingerprinting) | Most promising performance-only change. Needs proof that PNG encode/decode + file I/O actually dominates video/photo fingerprint time. |
| 3 | Progressive video matching (cheap first-frame filter, escalate to 3-frame only on collision) | Promising, but is a **behavior-changing** idea — must be validated against detection accuracy, not just speed. |
| 4 | Video decoder/player reuse | Plausible but uncertain on Android; must be benchmarked, not assumed. |
| 5 | Bounded concurrency (test 1–4 parallel operations) | Cheap to test, mobile-safe experiment, low risk. |
| 6 | Better candidate filtering (duration tolerance, aspect ratio, frame rate, etc.) | Low-risk, good ROI if candidate-group sizes are large. Must not reintroduce file size into the primary key (that's Fast Scan's job). |
| 7 | Replace exact PNG hash with perceptual hash (aHash/dHash/pHash) | Behavior-changing — evaluate false positive/negative rate before adopting. |
| 8 | Persistent fingerprint cache across scans | Valuable but secondary; doesn't fix first-run latency. |

**Guardrail that must not be violated by any change:** Deep Scan's purpose is
to catch resized/re-encoded/visually-equivalent media that Fast Scan misses.
Any change that makes Deep Scan behave like Fast Scan (e.g., requiring file
size or exact byte match) is out of scope, even if it's faster.

## Required first step (do this before optimizing anything)

Add lightweight timing instrumentation to establish a real baseline. Do not
implement any of the ideas above until this exists and has been run once on
a representative library (ideally the Samsung S21 or an equivalent
mid/low-end Android device).

### 1. Add a profiler utility

Create `src/services/scanProfiler.ts`:

```ts
type Bucket = { count: number; totalMs: number; maxMs: number };
const buckets = new Map<string, Bucket>();

export function record(label: string, ms: number) {
  const b = buckets.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
  b.count += 1;
  b.totalMs += ms;
  b.maxMs = Math.max(b.maxMs, ms);
  buckets.set(label, b);
}

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - start);
  }
}

export function report() {
  const rows = [...buckets.entries()].map(([label, b]) => ({
    label,
    count: b.count,
    totalMs: Math.round(b.totalMs),
    avgMs: Math.round(b.totalMs / b.count),
    maxMs: Math.round(b.maxMs),
  })).sort((a, b) => b.totalMs - a.totalMs);
  console.log('[ScanProfile]', JSON.stringify(rows, null, 2));
  return rows;
}

export function reset() { buckets.clear(); }
```

Gate it so it has zero cost in production (e.g. only active under `__DEV__`
or a feature flag).

### 2. Wrap phases in `duplicateDetection.ts`

At minimum, wrap with `timed(...)`:

- Metadata grouping loop (`getMediaFile` + key building) — per asset and
  total.
- `normalizedPhotoFingerprint`: resize/render, PNG save, hash, delete —
  separate labels for each step.
- `getVideoFingerprint`: `createVideoPlayer`, `generateThumbnailsAsync`,
  per-thumbnail normalize (`ImageManipulator` render+save), per-thumbnail
  hash, `player.release()` — separate labels for each step.
- Log `candidates.length` for photo vs. video groups before the
  fingerprinting loop (needed to know how many videos actually enter the
  expensive path vs. total library size).

### 3. Call `report()` from `useScanOperation.ts`

Call `reset()` at the start of `startScan`, and `report()` right after
`findDuplicateGroups`/`findDuplicateGroupsLegacy` resolves, so the log
appears once per scan.

### 4. Run once on target device(s) and record results

Capture, at minimum:

- Total scan time.
- Total time in metadata grouping vs. fingerprinting.
- Total time in photo fingerprinting vs. video fingerprinting (and % of
  total scan time each represents).
- Per-step breakdown for video: player create, thumbnail extraction,
  normalize, hash, release — both `totalMs` and `avgMs` per video.
- Number of candidate photos/videos vs. total library size.

Save these numbers somewhere durable (this doc, a linked results file, or a
tracked issue) as the "before" baseline.

## After the baseline exists

Use the baseline to decide which single optimization to attempt first:

- PNG/hash steps dominate → prioritize in-memory fingerprinting (idea #2).
- Player create/thumbnail extraction dominates → prioritize decoder reuse
  (idea #4) or progressive matching (idea #3).
- Candidate-group sizes are large relative to library size → prioritize
  candidate filtering (idea #6) before touching the fingerprint algorithm.
- Enumeration/metadata phase dominates → none of the video-specific ideas
  matter yet; look at `MediaLibrary.getAssetsAsync` paging instead.

Implement **one change at a time**, re-run the same benchmark on the same
library/device, and compare against the baseline before moving to the next
change. Any change to the fingerprint algorithm itself (perceptual hash,
progressive matching) must also be checked against detection accuracy
(known duplicate pairs should still match; known non-duplicates should
still not match), not just speed.

## Open questions the next agent should answer via profiling, not guesswork

1. What percentage of total Deep Scan time is video fingerprinting?
2. How many candidate videos/photos are actually processed vs. total library
   size?
3. Within video fingerprinting, what's the split between player
   creation/release, thumbnail extraction, PNG normalization, and hashing?
4. Does concurrency (1–4 parallel fingerprint operations) improve throughput
   on the target device without memory/thermal problems?
5. Does any proposed change alter which files are grouped as duplicates
   compared to the current behavior?
