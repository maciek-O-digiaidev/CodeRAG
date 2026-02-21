/**
 * Performance measurement utilities.
 */

/**
 * Measure the wall-clock execution time of an async function.
 * Returns the result and the duration in milliseconds.
 */
export async function measureTime<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Capture the current memory usage snapshot.
 * Returns heap used and RSS in megabytes.
 */
export function measureMemory(): { heapUsedMB: number; rssMB: number } {
  const usage = process.memoryUsage();
  return {
    heapUsedMB: usage.heapUsed / (1024 * 1024),
    rssMB: usage.rss / (1024 * 1024),
  };
}

/**
 * Compute percentile values from a sorted array of measurements.
 *
 * @param values - Array of numeric values (will be sorted internally).
 * @param percentiles - Array of percentile values to compute (e.g., [50, 95, 99]).
 * @returns Map from percentile to computed value.
 */
export function computePercentiles(
  values: number[],
  percentiles: number[],
): Map<number, number> {
  const result = new Map<number, number>();

  if (values.length === 0) {
    for (const p of percentiles) {
      result.set(p, 0);
    }
    return result;
  }

  const sorted = [...values].sort((a, b) => a - b);

  for (const p of percentiles) {
    const clampedP = Math.max(0, Math.min(100, p));
    const index = Math.ceil((clampedP / 100) * sorted.length) - 1;
    const clampedIndex = Math.max(0, Math.min(sorted.length - 1, index));
    result.set(p, sorted[clampedIndex]!);
  }

  return result;
}
