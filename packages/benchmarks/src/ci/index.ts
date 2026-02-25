/**
 * CI benchmark integration — barrel export.
 *
 * Provides baseline management, regression detection, PR comment formatting,
 * and the CI benchmark orchestrator.
 */

// Types
export type {
  TrackedMetricName,
  BaselineData,
  CIBenchmarkResult,
  MetricComparison,
  RegressionReport,
  HistoryEntry,
} from './types.js';
export { TRACKED_METRIC_NAMES } from './types.js';

// Baseline manager
export {
  loadBaseline,
  saveBaseline,
  createBaseline,
  appendHistory,
  toHistoryEntry,
} from './baseline-manager.js';
export type { BaselineError } from './baseline-manager.js';

// Regression detection
export {
  DEFAULT_THRESHOLD_PERCENT,
  compareMetric,
  compareAllMetrics,
  detectRegressions,
  getRegressedMetricsSummary,
  formatMetricName,
} from './regression-detector.js';

// CI reporter
export {
  formatPRComment,
  formatHeader,
  formatMetricsTable,
  formatDelta,
  formatStatus,
  formatMetadata,
  formatStatusLine,
  formatStandaloneReport,
} from './ci-reporter.js';

// CI benchmark orchestrator
export {
  DEFAULT_CI_CONFIG,
  runCIBenchmark,
  buildManifestRetrievalFn,
  scoreEntity,
  tokenize,
  runQuickValidation,
} from './run-ci-benchmark.js';
export type { CIBenchmarkConfig, CIBenchmarkError } from './run-ci-benchmark.js';
