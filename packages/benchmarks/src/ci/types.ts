/**
 * Type definitions for CI benchmark integration and regression detection.
 *
 * These types describe baselines, benchmark results, and regression reports
 * used by the CI pipeline to detect metric regressions on pull requests.
 */

import type { AggregateMetrics } from '../metrics/types.js';

/** Names of the tracked IR metrics used for regression detection. */
export type TrackedMetricName =
  | 'precisionAt5'
  | 'precisionAt10'
  | 'recallAt5'
  | 'recallAt10'
  | 'mrr'
  | 'ndcgAt10'
  | 'map'
  | 'contextPrecision';

/** All tracked metric names as a readonly array for iteration. */
export const TRACKED_METRIC_NAMES: readonly TrackedMetricName[] = [
  'precisionAt5',
  'precisionAt10',
  'recallAt5',
  'recallAt10',
  'mrr',
  'ndcgAt10',
  'map',
  'contextPrecision',
] as const;

/** A stored baseline containing aggregate metrics and metadata. */
export interface BaselineData {
  /** ISO timestamp when the baseline was created. */
  readonly timestamp: string;
  /** Git commit SHA the baseline was generated from. */
  readonly commitSha: string;
  /** Seed used for the synthetic repo generation. */
  readonly seed: number;
  /** Number of queries in the benchmark dataset. */
  readonly queryCount: number;
  /** Aggregate metrics serving as the regression threshold. */
  readonly metrics: AggregateMetrics;
}

/** Result of a single CI benchmark run. */
export interface CIBenchmarkResult {
  /** ISO timestamp of the benchmark run. */
  readonly timestamp: string;
  /** Git commit SHA being benchmarked. */
  readonly commitSha: string;
  /** Git branch name. */
  readonly branch: string;
  /** Seed used for synthetic repo generation. */
  readonly seed: number;
  /** Number of queries evaluated. */
  readonly queryCount: number;
  /** Duration of the full benchmark run in milliseconds. */
  readonly durationMs: number;
  /** Aggregate metrics from the run. */
  readonly metrics: AggregateMetrics;
}

/** Comparison of a single metric between baseline and current. */
export interface MetricComparison {
  /** Name of the metric. */
  readonly name: TrackedMetricName;
  /** Baseline value. */
  readonly baseline: number;
  /** Current run value. */
  readonly current: number;
  /** Absolute change (current - baseline). */
  readonly delta: number;
  /** Percentage change relative to baseline. */
  readonly deltaPercent: number;
  /** Whether this metric regressed beyond the threshold. */
  readonly regressed: boolean;
}

/** Full regression report comparing current results against baseline. */
export interface RegressionReport {
  /** Whether any metric regressed beyond the threshold. */
  readonly hasRegression: boolean;
  /** The threshold percentage used for detection (e.g., 5.0). */
  readonly thresholdPercent: number;
  /** Per-metric comparison details. */
  readonly comparisons: readonly MetricComparison[];
  /** The current benchmark result. */
  readonly current: CIBenchmarkResult;
  /** The baseline that was compared against (null if no baseline exists). */
  readonly baseline: BaselineData | null;
}

/** A historical entry for tracking benchmark results over time. */
export interface HistoryEntry {
  /** ISO timestamp of the run. */
  readonly timestamp: string;
  /** Git commit SHA. */
  readonly commitSha: string;
  /** Branch name. */
  readonly branch: string;
  /** Aggregate metrics from the run. */
  readonly metrics: AggregateMetrics;
  /** Duration of the run in milliseconds. */
  readonly durationMs: number;
}
