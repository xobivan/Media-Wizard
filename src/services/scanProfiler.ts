type Bucket = {
  count: number;
  totalMs: number;
  maxMs: number;
};

export type ScanProfileRow = Bucket & {
  label: string;
  avgMs: number;
};

const buckets = new Map<string, Bucket>();

function isEnabled() {
  return __DEV__;
}

export function record(label: string, ms: number): void {
  if (!isEnabled()) return;

  const bucket = buckets.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
  bucket.count += 1;
  bucket.totalMs += ms;
  bucket.maxMs = Math.max(bucket.maxMs, ms);
  buckets.set(label, bucket);
}

export function count(label: string, amount = 1): void {
  if (!isEnabled()) return;

  const bucket = buckets.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
  bucket.count += amount;
  buckets.set(label, bucket);
}

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!isEnabled()) return fn();

  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - start);
  }
}

export function timedSync<T>(label: string, fn: () => T): T {
  if (!isEnabled()) return fn();

  const start = performance.now();
  try {
    return fn();
  } finally {
    record(label, performance.now() - start);
  }
}

export function reset(): void {
  if (isEnabled()) buckets.clear();
}

export function report(): ScanProfileRow[] {
  if (!isEnabled()) return [];

  const rows = [...buckets.entries()]
    .map(([label, bucket]) => ({
      label,
      count: bucket.count,
      totalMs: Math.round(bucket.totalMs),
      avgMs: bucket.count > 0 ? Math.round(bucket.totalMs / bucket.count) : 0,
      maxMs: Math.round(bucket.maxMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  console.log('[ScanProfile]', JSON.stringify(rows, null, 2));
  return rows;
}
