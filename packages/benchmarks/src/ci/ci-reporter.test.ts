import { describe, it, expect } from 'vitest';
import type { AggregateMetrics } from '../metrics/types.js';
import type {
  BaselineData,
  CIBenchmarkResult,
  MetricComparison,
  RegressionReport,
} from './types.js';
import {
  formatPRComment,
  formatHeader,
  formatMetricsTable,
  formatDelta,
  formatStatus,
  formatMetadata,
  formatStatusLine,
  formatStandaloneReport,
} from './ci-reporter.js';

// ---------------------------------------------------------------------------
// Fixtures
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

function makeResult(overrides: Partial<CIBenchmarkResult> = {}): CIBenchmarkResult {
  return {
    timestamp: '2026-01-02T12:00:00.000Z',
    commitSha: 'def456',
    branch: 'feature/test',
    seed: 42,
    queryCount: 50,
    durationMs: 1500,
    metrics: makeMetrics(),
    ...overrides,
  };
}

function makeBaseline(): BaselineData {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    commitSha: 'abc123',
    seed: 42,
    queryCount: 50,
    metrics: makeMetrics(),
  };
}

function makeComparison(overrides: Partial<MetricComparison> = {}): MetricComparison {
  return {
    name: 'precisionAt5',
    baseline: 0.8,
    current: 0.8,
    delta: 0,
    deltaPercent: 0,
    regressed: false,
    ...overrides,
  };
}

function makePassingReport(): RegressionReport {
  return {
    hasRegression: false,
    thresholdPercent: 5,
    comparisons: [
      makeComparison({ name: 'precisionAt5' }),
      makeComparison({ name: 'mrr', baseline: 0.9, current: 0.9 }),
    ],
    current: makeResult(),
    baseline: makeBaseline(),
  };
}

function makeFailingReport(): RegressionReport {
  return {
    hasRegression: true,
    thresholdPercent: 5,
    comparisons: [
      makeComparison({
        name: 'precisionAt5',
        baseline: 0.8,
        current: 0.5,
        delta: -0.3,
        deltaPercent: -37.5,
        regressed: true,
      }),
      makeComparison({ name: 'mrr', baseline: 0.9, current: 0.9 }),
    ],
    current: makeResult({ metrics: makeMetrics({ precisionAt5: 0.5 }) }),
    baseline: makeBaseline(),
  };
}

function makeFirstRunReport(): RegressionReport {
  return {
    hasRegression: false,
    thresholdPercent: 5,
    comparisons: [
      makeComparison({ name: 'precisionAt5', baseline: 0, current: 0.8 }),
    ],
    current: makeResult(),
    baseline: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatHeader', () => {
  it('should show PASSED for no regressions', () => {
    const header = formatHeader(makePassingReport());
    expect(header).toContain('PASSED');
    expect(header).toContain('5%');
  });

  it('should show REGRESSION DETECTED for failures', () => {
    const header = formatHeader(makeFailingReport());
    expect(header).toContain('REGRESSION DETECTED');
    expect(header).toContain('1 metric(s) regressed');
    expect(header).toContain('Precision@5');
  });

  it('should show First Run for no baseline', () => {
    const header = formatHeader(makeFirstRunReport());
    expect(header).toContain('First Run');
    expect(header).toContain('new baseline');
  });
});

describe('formatMetricsTable', () => {
  it('should show simple table when no baseline', () => {
    const comparisons = [
      makeComparison({ name: 'precisionAt5', current: 0.8 }),
      makeComparison({ name: 'mrr', current: 0.9 }),
    ];
    const table = formatMetricsTable(comparisons, false);

    expect(table).toContain('| Metric | Value |');
    expect(table).toContain('Precision@5');
    expect(table).toContain('0.8000');
    expect(table).not.toContain('Delta');
  });

  it('should show full comparison table with baseline', () => {
    const comparisons = [
      makeComparison({
        name: 'precisionAt5',
        baseline: 0.8,
        current: 0.75,
        delta: -0.05,
        deltaPercent: -6.25,
        regressed: true,
      }),
    ];
    const table = formatMetricsTable(comparisons, true);

    expect(table).toContain('| Metric | Baseline | Current | Delta | Status |');
    expect(table).toContain('Precision@5');
    expect(table).toContain('0.8000');
    expect(table).toContain('0.7500');
    expect(table).toContain('REGRESSED');
  });
});

describe('formatDelta', () => {
  it('should show positive delta with plus sign', () => {
    const comparison = makeComparison({
      delta: 0.05,
      deltaPercent: 6.25,
    });
    const result = formatDelta(comparison);
    expect(result).toContain('+');
    expect(result).toContain('6.3%');
  });

  it('should show negative delta without plus sign', () => {
    const comparison = makeComparison({
      delta: -0.1,
      deltaPercent: -12.5,
    });
    const result = formatDelta(comparison);
    expect(result).toContain('-0.1000');
    expect(result).toContain('-12.5%');
  });

  it('should show zero delta with plus sign', () => {
    const comparison = makeComparison({ delta: 0, deltaPercent: 0 });
    const result = formatDelta(comparison);
    expect(result).toContain('+0.0000');
  });
});

describe('formatStatus', () => {
  it('should return REGRESSED for regressed metrics', () => {
    expect(formatStatus(makeComparison({ regressed: true, delta: -0.1 }))).toBe('REGRESSED');
  });

  it('should return improved for positive delta', () => {
    expect(formatStatus(makeComparison({ delta: 0.05 }))).toBe('improved');
  });

  it('should return unchanged for zero delta', () => {
    expect(formatStatus(makeComparison({ delta: 0 }))).toBe('unchanged');
  });

  it('should return ok for small negative delta without regression', () => {
    expect(formatStatus(makeComparison({ delta: -0.01 }))).toBe('ok');
  });
});

describe('formatMetadata', () => {
  it('should include commit sha and branch', () => {
    const report = makePassingReport();
    const metadata = formatMetadata(report);

    expect(metadata).toContain('def456');
    expect(metadata).toContain('feature/test');
    expect(metadata).toContain('50');
  });

  it('should include baseline info when present', () => {
    const report = makePassingReport();
    const metadata = formatMetadata(report);

    expect(metadata).toContain('abc123');
    expect(metadata).toContain('2026-01-01');
  });

  it('should not include baseline info when null', () => {
    const report = makeFirstRunReport();
    const metadata = formatMetadata(report);

    expect(metadata).not.toContain('Baseline commit');
  });

  it('should wrap in details/summary tags', () => {
    const metadata = formatMetadata(makePassingReport());
    expect(metadata).toContain('<details>');
    expect(metadata).toContain('</details>');
    expect(metadata).toContain('<summary>Run Details</summary>');
  });
});

describe('formatStatusLine', () => {
  it('should show first run message when no baseline', () => {
    const line = formatStatusLine(makeFirstRunReport());
    expect(line).toContain('first run');
  });

  it('should show PASSED for passing report', () => {
    const line = formatStatusLine(makePassingReport());
    expect(line).toContain('PASSED');
  });

  it('should show FAILED for failing report', () => {
    const line = formatStatusLine(makeFailingReport());
    expect(line).toContain('FAILED');
    expect(line).toContain('1 metric(s)');
  });
});

describe('formatPRComment', () => {
  it('should produce a complete markdown comment for passing report', () => {
    const comment = formatPRComment(makePassingReport());

    expect(comment).toContain('PASSED');
    expect(comment).toContain('Metric');
    expect(comment).toContain('Run Details');
    expect(comment).toContain('Generated by CodeRAG Benchmark CI');
  });

  it('should produce a complete markdown comment for failing report', () => {
    const comment = formatPRComment(makeFailingReport());

    expect(comment).toContain('REGRESSION DETECTED');
    expect(comment).toContain('REGRESSED');
    expect(comment).toContain('Precision@5');
  });

  it('should produce a complete markdown comment for first run', () => {
    const comment = formatPRComment(makeFirstRunReport());

    expect(comment).toContain('First Run');
    expect(comment).toContain('new baseline');
  });
});

describe('formatStandaloneReport', () => {
  it('should format a standalone report without baseline', () => {
    const report = formatStandaloneReport(makeResult());

    expect(report).toContain('Benchmark Results');
    expect(report).toContain('def456');
    expect(report).toContain('feature/test');
    expect(report).toContain('Precision@5');
    expect(report).toContain('0.8000');
  });

  it('should include duration formatting', () => {
    const report = formatStandaloneReport(makeResult({ durationMs: 1500 }));
    expect(report).toContain('1.5s');
  });

  it('should format millisecond durations', () => {
    const report = formatStandaloneReport(makeResult({ durationMs: 500 }));
    expect(report).toContain('500ms');
  });

  it('should format minute durations', () => {
    const report = formatStandaloneReport(makeResult({ durationMs: 75000 }));
    expect(report).toContain('1m');
  });
});
