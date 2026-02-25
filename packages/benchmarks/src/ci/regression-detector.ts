/**
 * Regression detection for CI benchmark results.
 *
 * Compares current benchmark metrics against a stored baseline and
 * flags regressions where any metric drops more than a configurable
 * threshold (default: 5%).
 *
 * All functions are pure (no I/O) and stateless.
 */

import type { AggregateMetrics } from '../metrics/types.js';
import type {
  BaselineData,
  CIBenchmarkResult,
  MetricComparison,
  RegressionReport,
  TrackedMetricName,
} from './types.js';
import { TRACKED_METRIC_NAMES } from './types.js';

/** Default regression threshold: 5% drop triggers failure. */
export const DEFAULT_THRESHOLD_PERCENT = 5.0;

/**
 * Compare a single metric value between baseline and current.
 *
 * A metric is considered regressed if the current value dropped by more
 * than `thresholdPercent` relative to the baseline. A baseline of zero
 * is treated as a special case: only a current value of zero avoids
 * regression (any positive value is an improvement, not a regression).
 */
export function compareMetric(
  name: TrackedMetricName,
  baseline: number,
  current: number,
  thresholdPercent: number,
): MetricComparison {
  const delta = current - baseline;

  // Avoid division by zero: if baseline is zero, no regression is possible
  // (you can't drop below zero). If current is also zero, deltaPercent is 0.
  const deltaPercent = baseline === 0 ? 0 : (delta / baseline) * 100;

  // Regression = negative change exceeding the threshold
  const regressed = deltaPercent < -thresholdPercent;

  return {
    name,
    baseline,
    current,
    delta,
    deltaPercent,
    regressed,
  };
}

/**
 * Compare all tracked metrics between baseline and current aggregate metrics.
 *
 * Returns a list of MetricComparison objects for each tracked metric.
 */
export function compareAllMetrics(
  baseline: AggregateMetrics,
  current: AggregateMetrics,
  thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT,
): readonly MetricComparison[] {
  return TRACKED_METRIC_NAMES.map((name) =>
    compareMetric(name, baseline[name], current[name], thresholdPercent),
  );
}

/**
 * Detect regressions by comparing current benchmark results against a baseline.
 *
 * If no baseline is provided (null), the report will indicate no regression
 * (first run scenario — there is nothing to regress against).
 */
export function detectRegressions(
  current: CIBenchmarkResult,
  baseline: BaselineData | null,
  thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT,
): RegressionReport {
  if (baseline === null) {
    // No baseline to compare against — first run, no regressions possible
    return {
      hasRegression: false,
      thresholdPercent,
      comparisons: TRACKED_METRIC_NAMES.map((name) => ({
        name,
        baseline: 0,
        current: current.metrics[name],
        delta: current.metrics[name],
        deltaPercent: 0,
        regressed: false,
      })),
      current,
      baseline: null,
    };
  }

  const comparisons = compareAllMetrics(
    baseline.metrics,
    current.metrics,
    thresholdPercent,
  );

  const hasRegression = comparisons.some((c) => c.regressed);

  return {
    hasRegression,
    thresholdPercent,
    comparisons,
    current,
    baseline,
  };
}

/**
 * Get a human-readable summary of regressed metrics.
 *
 * Returns an array of formatted strings describing each regression,
 * or an empty array if no regressions were detected.
 */
export function getRegressedMetricsSummary(
  report: RegressionReport,
): readonly string[] {
  return report.comparisons
    .filter((c) => c.regressed)
    .map((c) => {
      const direction = c.delta < 0 ? 'dropped' : 'changed';
      return `${formatMetricName(c.name)} ${direction} by ${Math.abs(c.deltaPercent).toFixed(2)}% (${c.baseline.toFixed(4)} -> ${c.current.toFixed(4)})`;
    });
}

/**
 * Format a TrackedMetricName into a human-readable label.
 */
export function formatMetricName(name: TrackedMetricName): string {
  const labels: Record<TrackedMetricName, string> = {
    precisionAt5: 'Precision@5',
    precisionAt10: 'Precision@10',
    recallAt5: 'Recall@5',
    recallAt10: 'Recall@10',
    mrr: 'MRR',
    ndcgAt10: 'nDCG@10',
    map: 'MAP',
    contextPrecision: 'Context Precision',
  };
  return labels[name];
}
