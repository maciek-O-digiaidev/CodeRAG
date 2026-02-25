import { describe, it, expect } from 'vitest';
import type { AggregateMetrics } from '../metrics/types.js';
import type { BaselineData, CIBenchmarkResult } from './types.js';
import { TRACKED_METRIC_NAMES } from './types.js';
import {
  DEFAULT_THRESHOLD_PERCENT,
  compareMetric,
  compareAllMetrics,
  detectRegressions,
  getRegressedMetricsSummary,
  formatMetricName,
} from './regression-detector.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  return {
    precisionAt5: 0.8,
    precisionAt10: 0.6,
    recallAt5: 0.7,
    recallAt10: 0.5,
    mrr: 0.9,
    ndcgAt10: 0.75,
    map: 0.65,
    contextPrecision: 0.85,
    contextRecall: null,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<BaselineData> = {}): BaselineData {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    commitSha: 'abc123',
    seed: 42,
    queryCount: 50,
    metrics: makeMetrics(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<CIBenchmarkResult> = {}): CIBenchmarkResult {
  return {
    timestamp: '2026-01-02T00:00:00.000Z',
    commitSha: 'def456',
    branch: 'feature/test',
    seed: 42,
    queryCount: 50,
    durationMs: 1500,
    metrics: makeMetrics(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DEFAULT_THRESHOLD_PERCENT', () => {
  it('should be 5.0', () => {
    expect(DEFAULT_THRESHOLD_PERCENT).toBe(5.0);
  });
});

describe('compareMetric', () => {
  it('should detect no change when values are equal', () => {
    const result = compareMetric('precisionAt5', 0.8, 0.8, 5);
    expect(result.delta).toBe(0);
    expect(result.deltaPercent).toBe(0);
    expect(result.regressed).toBe(false);
  });

  it('should detect improvement when current is higher', () => {
    const result = compareMetric('mrr', 0.8, 0.9, 5);
    expect(result.delta).toBeCloseTo(0.1);
    expect(result.deltaPercent).toBeCloseTo(12.5);
    expect(result.regressed).toBe(false);
  });

  it('should detect regression when drop exceeds threshold', () => {
    const result = compareMetric('precisionAt5', 0.8, 0.7, 5);
    expect(result.delta).toBeCloseTo(-0.1);
    expect(result.deltaPercent).toBeCloseTo(-12.5);
    expect(result.regressed).toBe(true);
  });

  it('should not flag regression when drop is within threshold', () => {
    // 4% drop on 0.8 = 0.768
    const result = compareMetric('recallAt5', 0.8, 0.768, 5);
    expect(result.deltaPercent).toBeCloseTo(-4.0);
    expect(result.regressed).toBe(false);
  });

  it('should handle baseline of zero without division error', () => {
    const result = compareMetric('map', 0, 0.5, 5);
    expect(result.deltaPercent).toBe(0);
    expect(result.regressed).toBe(false);
  });

  it('should handle both values being zero', () => {
    const result = compareMetric('ndcgAt10', 0, 0, 5);
    expect(result.delta).toBe(0);
    expect(result.deltaPercent).toBe(0);
    expect(result.regressed).toBe(false);
  });

  it('should include correct name in output', () => {
    const result = compareMetric('contextPrecision', 0.5, 0.4, 5);
    expect(result.name).toBe('contextPrecision');
  });
});

describe('compareAllMetrics', () => {
  it('should compare all tracked metrics', () => {
    const baseline = makeMetrics();
    const current = makeMetrics();
    const comparisons = compareAllMetrics(baseline, current, 5);

    expect(comparisons).toHaveLength(TRACKED_METRIC_NAMES.length);
    for (const c of comparisons) {
      expect(TRACKED_METRIC_NAMES).toContain(c.name);
      expect(c.regressed).toBe(false);
    }
  });

  it('should detect multiple regressions', () => {
    const baseline = makeMetrics();
    const current = makeMetrics({
      precisionAt5: 0.5,   // ~37.5% drop
      mrr: 0.6,            // ~33% drop
    });

    const comparisons = compareAllMetrics(baseline, current, 5);
    const regressed = comparisons.filter((c) => c.regressed);
    expect(regressed.length).toBe(2);

    const regressedNames = regressed.map((c) => c.name);
    expect(regressedNames).toContain('precisionAt5');
    expect(regressedNames).toContain('mrr');
  });

  it('should use default threshold when not specified', () => {
    const baseline = makeMetrics();
    const current = makeMetrics({ precisionAt5: 0.5 });
    const comparisons = compareAllMetrics(baseline, current);
    const regressed = comparisons.filter((c) => c.regressed);
    expect(regressed.length).toBeGreaterThan(0);
  });
});

describe('detectRegressions', () => {
  it('should report no regression when metrics match', () => {
    const current = makeResult();
    const baseline = makeBaseline();
    const report = detectRegressions(current, baseline);

    expect(report.hasRegression).toBe(false);
    expect(report.thresholdPercent).toBe(5);
    expect(report.baseline).toBe(baseline);
    expect(report.current).toBe(current);
  });

  it('should report regression when metric drops beyond threshold', () => {
    const current = makeResult({
      metrics: makeMetrics({ precisionAt5: 0.3 }),
    });
    const baseline = makeBaseline();
    const report = detectRegressions(current, baseline);

    expect(report.hasRegression).toBe(true);
  });

  it('should handle null baseline (first run)', () => {
    const current = makeResult();
    const report = detectRegressions(current, null);

    expect(report.hasRegression).toBe(false);
    expect(report.baseline).toBeNull();
    expect(report.comparisons).toHaveLength(TRACKED_METRIC_NAMES.length);
    for (const c of report.comparisons) {
      expect(c.baseline).toBe(0);
      expect(c.regressed).toBe(false);
    }
  });

  it('should accept a custom threshold', () => {
    const current = makeResult({
      metrics: makeMetrics({ mrr: 0.88 }),
    });
    const baseline = makeBaseline();

    // With 5% threshold, ~2.2% drop should pass
    const report5 = detectRegressions(current, baseline, 5);
    expect(report5.hasRegression).toBe(false);

    // With 1% threshold, ~2.2% drop should fail
    const report1 = detectRegressions(current, baseline, 1);
    expect(report1.hasRegression).toBe(true);
  });
});

describe('getRegressedMetricsSummary', () => {
  it('should return empty array when no regressions', () => {
    const report = detectRegressions(makeResult(), makeBaseline());
    const summary = getRegressedMetricsSummary(report);
    expect(summary).toEqual([]);
  });

  it('should describe each regressed metric', () => {
    const current = makeResult({
      metrics: makeMetrics({ precisionAt5: 0.5, mrr: 0.6 }),
    });
    const report = detectRegressions(current, makeBaseline());
    const summary = getRegressedMetricsSummary(report);

    expect(summary).toHaveLength(2);
    expect(summary[0]).toContain('Precision@5');
    expect(summary[0]).toContain('dropped');
    expect(summary[1]).toContain('MRR');
  });
});

describe('formatMetricName', () => {
  it('should format all metric names to human-readable labels', () => {
    expect(formatMetricName('precisionAt5')).toBe('Precision@5');
    expect(formatMetricName('precisionAt10')).toBe('Precision@10');
    expect(formatMetricName('recallAt5')).toBe('Recall@5');
    expect(formatMetricName('recallAt10')).toBe('Recall@10');
    expect(formatMetricName('mrr')).toBe('MRR');
    expect(formatMetricName('ndcgAt10')).toBe('nDCG@10');
    expect(formatMetricName('map')).toBe('MAP');
    expect(formatMetricName('contextPrecision')).toBe('Context Precision');
  });
});
