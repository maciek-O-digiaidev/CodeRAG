// Auto-generated benchmark module — barrel export

// Index scanner
export type {
  ScannedEntity,
  IndexScanResult,
} from './index-scanner.js';
export {
  IndexScanError,
  parseIndexRows,
  buildCallerMap,
  buildTestMap,
} from './index-scanner.js';

// Query generator
export type {
  BenchmarkQueryType,
  GeneratedQuery,
  QueryGeneratorOptions,
} from './query-generator.js';
export {
  generateQueries,
  generateFindByNameQueries,
  generateFindByDescriptionQueries,
  generateFindCallersQueries,
  generateFindTestsQueries,
  generateFindImportsQueries,
} from './query-generator.js';

// Benchmark evaluator
export type {
  QueryEvalResult,
  QueryMetrics,
  AggregateEvalMetrics,
  QueryTypeBreakdown,
  BenchmarkReport,
  BenchmarkMetadata,
  SearchFn,
  BenchmarkProgressFn,
} from './benchmark-evaluator.js';
export {
  BenchmarkEvalError,
  computeQueryMetrics,
  computeAggregateMetrics,
  computeQueryTypeBreakdown,
  runBenchmark,
  formatBenchmarkSummary,
} from './benchmark-evaluator.js';
