// @code-rag/benchmarks — benchmark suite for CodeRAG search quality and performance
export const BENCHMARKS_VERSION = '0.1.0';

// Types
export type {
  BenchmarkDataset,
  BenchmarkQuery,
  BenchmarkMetrics,
  BenchmarkReport,
  QueryRunResult,
  QueryDifficulty,
  QueryCategory,
  ChunkRelevance,
  ExpectedChunk,
} from './types.js';

// Metrics
export {
  precisionAtK,
  recallAtK,
  meanReciprocalRank,
  ndcg,
} from './metrics.js';

// Benchmark runner
export {
  runBenchmark,
  loadDataset,
  extractRelevantPaths,
  computeQueryMetrics,
  computeAggregateMetrics,
  generateMarkdownReport,
} from './benchmark.js';
export type { RunnerFn } from './benchmark.js';

// Runners
export { runGrepSearch, parseGrepOutput, rankByOccurrence } from './runners/grep-runner.js';
export type { GrepResult } from './runners/grep-runner.js';
export { runCodeRAGSearch } from './runners/coderag-runner.js';
export type { CodeRAGResult } from './runners/coderag-runner.js';

// Performance
export { measureTime, measureMemory, computePercentiles } from './perf/measure.js';
export {
  benchmarkQueryLatency,
  benchmarkIndexingSpeed,
  runPerfBenchmark,
} from './perf/perf-benchmark.js';
export type { LatencyResult, IndexingSpeedResult } from './perf/perf-benchmark.js';
