// Portable IR metrics runner — barrel export

// Types
export type {
  GenericBenchmarkQuery,
  GenericBenchmarkDataset,
  QueryMetricsResult,
  SingleQueryMetrics,
  AggregateMetrics,
  MetricsReport,
  ReportMetadata,
  RetrievalFn,
} from './types.js';

// Pure metric functions
export {
  precisionAtK,
  recallAtK,
  mrr,
  ndcgAtK,
  averagePrecision,
  contextPrecision,
  contextRecall,
} from './ir-metrics.js';

// Runner
export {
  runMetrics,
  computeSingleQueryMetrics,
  computeAggregateMetrics,
  adaptLegacyDataset,
} from './metrics-runner.js';

// Report output
export { writeJsonReport, writeMarkdownReport } from './report-writer.js';
