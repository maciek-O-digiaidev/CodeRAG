import { describe, it, expect } from 'vitest';
import { measureTime, measureMemory, computePercentiles } from './measure.js';

describe('measureTime', () => {
  it('should return the result of the async function', async () => {
    const { result } = await measureTime(async () => 42);
    expect(result).toBe(42);
  });

  it('should return a positive duration', async () => {
    const { durationMs } = await measureTime(async () => {
      // Small delay to ensure measurable time
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'done';
    });
    expect(durationMs).toBeGreaterThan(0);
  });

  it('should measure approximate duration', async () => {
    const delayMs = 50;
    const { durationMs } = await measureTime(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    });
    // Should be at least close to the delay (allow 10ms tolerance)
    expect(durationMs).toBeGreaterThanOrEqual(delayMs - 10);
    // Should not be wildly off (allow generous upper bound)
    expect(durationMs).toBeLessThan(delayMs + 200);
  });

  it('should propagate errors', async () => {
    await expect(
      measureTime(async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });
});

describe('measureMemory', () => {
  it('should return positive heap used value', () => {
    const { heapUsedMB } = measureMemory();
    expect(heapUsedMB).toBeGreaterThan(0);
  });

  it('should return positive RSS value', () => {
    const { rssMB } = measureMemory();
    expect(rssMB).toBeGreaterThan(0);
  });

  it('should return RSS >= heap used', () => {
    const { heapUsedMB, rssMB } = measureMemory();
    expect(rssMB).toBeGreaterThanOrEqual(heapUsedMB);
  });

  it('should return values in megabytes range', () => {
    const { heapUsedMB, rssMB } = measureMemory();
    // Node process typically uses at least a few MB
    expect(heapUsedMB).toBeGreaterThan(1);
    expect(rssMB).toBeGreaterThan(1);
    // But should be less than several GB
    expect(heapUsedMB).toBeLessThan(4096);
    expect(rssMB).toBeLessThan(4096);
  });
});

describe('computePercentiles', () => {
  it('should compute p50 for odd-length array', () => {
    const values = [10, 20, 30, 40, 50];
    const result = computePercentiles(values, [50]);
    expect(result.get(50)).toBe(30);
  });

  it('should compute p50 for even-length array', () => {
    const values = [10, 20, 30, 40];
    const result = computePercentiles(values, [50]);
    expect(result.get(50)).toBe(20);
  });

  it('should compute multiple percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = computePercentiles(values, [50, 95, 99]);

    expect(result.get(50)).toBe(50);
    expect(result.get(95)).toBe(95);
    expect(result.get(99)).toBe(99);
  });

  it('should handle unsorted input', () => {
    const values = [50, 10, 30, 20, 40];
    const result = computePercentiles(values, [50]);
    expect(result.get(50)).toBe(30);
  });

  it('should return 0 for empty values', () => {
    const result = computePercentiles([], [50, 95]);
    expect(result.get(50)).toBe(0);
    expect(result.get(95)).toBe(0);
  });

  it('should handle single-element array', () => {
    const result = computePercentiles([42], [50, 95, 99]);
    expect(result.get(50)).toBe(42);
    expect(result.get(95)).toBe(42);
    expect(result.get(99)).toBe(42);
  });

  it('should handle p0 and p100', () => {
    const values = [10, 20, 30, 40, 50];
    const result = computePercentiles(values, [0, 100]);
    expect(result.get(0)).toBe(10);
    expect(result.get(100)).toBe(50);
  });

  it('should not mutate the input array', () => {
    const values = [50, 10, 30, 20, 40];
    const original = [...values];
    computePercentiles(values, [50]);
    expect(values).toEqual(original);
  });
});
