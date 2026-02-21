/**
 * Performance benchmarking utilities for CodeRAG.
 *
 * Measures query latency and indexing throughput.
 */

import type { HybridSearch } from '@coderag/core';
import { measureTime, measureMemory, computePercentiles } from './measure.js';

export interface LatencyResult {
  totalQueries: number;
  iterations: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
  memoryBefore: { heapUsedMB: number; rssMB: number };
  memoryAfter: { heapUsedMB: number; rssMB: number };
}

export interface IndexingSpeedResult {
  totalFiles: number;
  totalLines: number;
  durationMs: number;
  filesPerSecond: number;
  linesPerSecond: number;
}

/**
 * Benchmark query latency by running each query multiple times.
 * Returns p50, p95, and p99 latency values.
 */
export async function benchmarkQueryLatency(
  hybridSearch: HybridSearch,
  queries: string[],
  iterations: number = 3,
): Promise<LatencyResult> {
  const memoryBefore = measureMemory();
  const durations: number[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    for (const query of queries) {
      const { durationMs } = await measureTime(() =>
        hybridSearch.search(query, { topK: 10 }),
      );
      durations.push(durationMs);
    }
  }

  const memoryAfter = measureMemory();
  const percentiles = computePercentiles(durations, [50, 95, 99]);
  const meanMs =
    durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

  return {
    totalQueries: queries.length,
    iterations,
    p50Ms: percentiles.get(50) ?? 0,
    p95Ms: percentiles.get(95) ?? 0,
    p99Ms: percentiles.get(99) ?? 0,
    meanMs,
    memoryBefore,
    memoryAfter,
  };
}

/**
 * Benchmark indexing speed by counting lines across provided file contents.
 * Accepts a process function that performs the actual indexing work.
 */
export async function benchmarkIndexingSpeed(
  files: { path: string; content: string }[],
  processFn: (files: { path: string; content: string }[]) => Promise<void>,
): Promise<IndexingSpeedResult> {
  const totalLines = files.reduce(
    (sum, f) => sum + f.content.split('\n').length,
    0,
  );

  const { durationMs } = await measureTime(() => processFn(files));

  const durationSec = durationMs / 1000;

  return {
    totalFiles: files.length,
    totalLines,
    durationMs,
    filesPerSecond: durationSec > 0 ? files.length / durationSec : 0,
    linesPerSecond: durationSec > 0 ? totalLines / durationSec : 0,
  };
}

/**
 * Run the full performance benchmark suite.
 */
export async function runPerfBenchmark(
  hybridSearch: HybridSearch,
  queries: string[],
  iterations: number = 3,
): Promise<LatencyResult> {
  return benchmarkQueryLatency(hybridSearch, queries, iterations);
}
