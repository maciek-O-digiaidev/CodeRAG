import { describe, it, expect } from 'vitest';
import {
  analyzeEfficiency,
  analyzeStrategyEfficiency,
  rankStrategiesByEfficiency,
  computeQualityAuc,
} from './efficiency-analyzer.js';
import type { BudgetLevelMetrics, EfficiencyAnalysis, QualityCurvePoint } from './types.js';

/** Helper to create a BudgetLevelMetrics with required fields. */
function makeBudgetMetrics(
  overrides: Partial<BudgetLevelMetrics> & { tokenBudget: number; strategy: BudgetLevelMetrics['strategy'] },
): BudgetLevelMetrics {
  return {
    queryCount: 10,
    meanPrecisionAt5: 0,
    meanPrecisionAt10: 0,
    meanRecallAt5: 0,
    meanRecallAt10: 0,
    meanMrr: 0,
    meanNdcgAt10: 0,
    meanNoiseRatio: 0.5,
    meanDurationMs: 100,
    meanTotalTokens: 500,
    ...overrides,
  };
}

describe('analyzeStrategyEfficiency', () => {
  it('should find 90% quality threshold for a strategy', () => {
    const metrics: BudgetLevelMetrics[] = [
      makeBudgetMetrics({ tokenBudget: 1000, strategy: 'topK', meanMrr: 0.3, meanRecallAt10: 0.2 }),
      makeBudgetMetrics({ tokenBudget: 2000, strategy: 'topK', meanMrr: 0.6, meanRecallAt10: 0.5 }),
      makeBudgetMetrics({ tokenBudget: 4000, strategy: 'topK', meanMrr: 0.85, meanRecallAt10: 0.7 }),
      makeBudgetMetrics({ tokenBudget: 8000, strategy: 'topK', meanMrr: 0.95, meanRecallAt10: 0.9 }),
    ];

    const result = analyzeStrategyEfficiency(metrics, 'topK', 0.9);

    // Max MRR is 0.95, 90% of that is 0.855
    // At budget 4000, MRR is 0.85 which is < 0.855
    // At budget 8000, MRR is 0.95 which is >= 0.855
    expect(result.tokensFor90PctQuality).toBe(8000);
    expect(result.maxMrr).toBe(0.95);
    expect(result.maxRecall).toBe(0.9);
    expect(result.qualityCurve).toHaveLength(4);
  });

  it('should return null when quality threshold is never reached', () => {
    const metrics: BudgetLevelMetrics[] = [
      makeBudgetMetrics({ tokenBudget: 1000, strategy: 'topK', meanMrr: 0.1 }),
      makeBudgetMetrics({ tokenBudget: 2000, strategy: 'topK', meanMrr: 0.2 }),
    ];

    // 90% of 0.2 is 0.18, which is reached at budget 2000
    const result = analyzeStrategyEfficiency(metrics, 'topK', 0.99);
    // 99% of 0.2 is 0.198, budget 2000 has 0.2 >= 0.198
    expect(result.tokensFor90PctQuality).toBe(2000);
  });

  it('should handle empty metrics array', () => {
    const result = analyzeStrategyEfficiency([], 'topK');

    expect(result.tokensFor90PctQuality).toBeNull();
    expect(result.maxMrr).toBe(0);
    expect(result.maxRecall).toBe(0);
    expect(result.qualityCurve).toHaveLength(0);
  });

  it('should handle single budget level', () => {
    const metrics: BudgetLevelMetrics[] = [
      makeBudgetMetrics({ tokenBudget: 4000, strategy: 'topK', meanMrr: 0.8, meanRecallAt10: 0.7 }),
    ];

    const result = analyzeStrategyEfficiency(metrics, 'topK', 0.9);

    // Single point: max MRR is 0.8, 90% is 0.72, and 0.8 >= 0.72
    expect(result.tokensFor90PctQuality).toBe(4000);
    expect(result.qualityCurve).toHaveLength(1);
    expect(result.qualityCurve[0]!.normalizedQuality).toBe(1);
  });

  it('should build normalized quality curve', () => {
    const metrics: BudgetLevelMetrics[] = [
      makeBudgetMetrics({ tokenBudget: 1000, strategy: 'topK', meanMrr: 0.5 }),
      makeBudgetMetrics({ tokenBudget: 2000, strategy: 'topK', meanMrr: 1.0 }),
    ];

    const result = analyzeStrategyEfficiency(metrics, 'topK');

    expect(result.qualityCurve[0]!.normalizedQuality).toBe(0.5);
    expect(result.qualityCurve[1]!.normalizedQuality).toBe(1.0);
  });

  it('should handle zero max MRR gracefully', () => {
    const metrics: BudgetLevelMetrics[] = [
      makeBudgetMetrics({ tokenBudget: 1000, strategy: 'topK', meanMrr: 0 }),
    ];

    const result = analyzeStrategyEfficiency(metrics, 'topK');

    expect(result.maxMrr).toBe(0);
    expect(result.qualityCurve[0]!.normalizedQuality).toBe(0);
  });

  it('should sort by budget ascending in quality curve', () => {
    const metrics: BudgetLevelMetrics[] = [
      makeBudgetMetrics({ tokenBudget: 8000, strategy: 'topK', meanMrr: 0.9 }),
      makeBudgetMetrics({ tokenBudget: 1000, strategy: 'topK', meanMrr: 0.3 }),
      makeBudgetMetrics({ tokenBudget: 4000, strategy: 'topK', meanMrr: 0.7 }),
    ];

    const result = analyzeStrategyEfficiency(metrics, 'topK');

    expect(result.qualityCurve.map((p) => p.tokenBudget)).toEqual([1000, 4000, 8000]);
  });
});

describe('analyzeEfficiency', () => {
  it('should analyze multiple strategies', () => {
    const metrics: BudgetLevelMetrics[] = [
      makeBudgetMetrics({ tokenBudget: 1000, strategy: 'topK', meanMrr: 0.3 }),
      makeBudgetMetrics({ tokenBudget: 2000, strategy: 'topK', meanMrr: 0.9 }),
      makeBudgetMetrics({ tokenBudget: 1000, strategy: 'reranking', meanMrr: 0.7 }),
      makeBudgetMetrics({ tokenBudget: 2000, strategy: 'reranking', meanMrr: 0.95 }),
    ];

    const results = analyzeEfficiency(metrics);

    expect(results).toHaveLength(2);
    expect(results[0]!.strategy).toBe('topK');
    expect(results[1]!.strategy).toBe('reranking');
  });

  it('should return empty for empty input', () => {
    const results = analyzeEfficiency([]);
    expect(results).toHaveLength(0);
  });

  it('should accept custom quality threshold', () => {
    const metrics: BudgetLevelMetrics[] = [
      makeBudgetMetrics({ tokenBudget: 1000, strategy: 'topK', meanMrr: 0.5 }),
      makeBudgetMetrics({ tokenBudget: 2000, strategy: 'topK', meanMrr: 0.8 }),
    ];

    // With 50% threshold: 50% of 0.8 = 0.4, reached at budget 1000
    const results = analyzeEfficiency(metrics, 0.5);
    expect(results[0]!.tokensFor90PctQuality).toBe(1000);
  });
});

describe('rankStrategiesByEfficiency', () => {
  it('should rank strategies by fewest tokens to reach threshold', () => {
    const analyses: EfficiencyAnalysis[] = [
      {
        strategy: 'topK',
        tokensFor90PctQuality: 8000,
        maxMrr: 0.9,
        maxRecall: 0.8,
        qualityCurve: [],
      },
      {
        strategy: 'budgetOptimized',
        tokensFor90PctQuality: 2000,
        maxMrr: 0.95,
        maxRecall: 0.9,
        qualityCurve: [],
      },
      {
        strategy: 'reranking',
        tokensFor90PctQuality: 4000,
        maxMrr: 0.92,
        maxRecall: 0.85,
        qualityCurve: [],
      },
    ];

    const ranked = rankStrategiesByEfficiency(analyses);

    expect(ranked[0]!.strategy).toBe('budgetOptimized');
    expect(ranked[1]!.strategy).toBe('reranking');
    expect(ranked[2]!.strategy).toBe('topK');
  });

  it('should put null-threshold strategies last', () => {
    const analyses: EfficiencyAnalysis[] = [
      {
        strategy: 'topK',
        tokensFor90PctQuality: null,
        maxMrr: 0.3,
        maxRecall: 0.2,
        qualityCurve: [],
      },
      {
        strategy: 'reranking',
        tokensFor90PctQuality: 4000,
        maxMrr: 0.9,
        maxRecall: 0.8,
        qualityCurve: [],
      },
    ];

    const ranked = rankStrategiesByEfficiency(analyses);

    expect(ranked[0]!.strategy).toBe('reranking');
    expect(ranked[1]!.strategy).toBe('topK');
  });

  it('should break ties among null-threshold by max MRR', () => {
    const analyses: EfficiencyAnalysis[] = [
      {
        strategy: 'topK',
        tokensFor90PctQuality: null,
        maxMrr: 0.3,
        maxRecall: 0.2,
        qualityCurve: [],
      },
      {
        strategy: 'graphExpansion',
        tokensFor90PctQuality: null,
        maxMrr: 0.5,
        maxRecall: 0.4,
        qualityCurve: [],
      },
    ];

    const ranked = rankStrategiesByEfficiency(analyses);

    expect(ranked[0]!.strategy).toBe('graphExpansion');
    expect(ranked[1]!.strategy).toBe('topK');
  });

  it('should handle empty array', () => {
    expect(rankStrategiesByEfficiency([])).toHaveLength(0);
  });
});

describe('computeQualityAuc', () => {
  it('should compute area under a perfect step curve', () => {
    // Quality is 1.0 at all points: AUC should be 1.0
    const curve: QualityCurvePoint[] = [
      { tokenBudget: 1000, normalizedQuality: 1.0, mrr: 1.0, recallAt10: 1.0, noiseRatio: 0 },
      { tokenBudget: 2000, normalizedQuality: 1.0, mrr: 1.0, recallAt10: 1.0, noiseRatio: 0 },
    ];

    expect(computeQualityAuc(curve)).toBeCloseTo(1.0);
  });

  it('should compute area under a linear ramp from 0 to 1', () => {
    const curve: QualityCurvePoint[] = [
      { tokenBudget: 0, normalizedQuality: 0, mrr: 0, recallAt10: 0, noiseRatio: 1 },
      { tokenBudget: 1000, normalizedQuality: 1.0, mrr: 1.0, recallAt10: 1.0, noiseRatio: 0 },
    ];

    // Trapezoidal: (0 + 1) / 2 * 1000 / 1000 = 0.5
    expect(computeQualityAuc(curve)).toBeCloseTo(0.5);
  });

  it('should return 0 for empty curve', () => {
    expect(computeQualityAuc([])).toBe(0);
  });

  it('should return 0 for single-point curve', () => {
    const curve: QualityCurvePoint[] = [
      { tokenBudget: 1000, normalizedQuality: 1.0, mrr: 1.0, recallAt10: 1.0, noiseRatio: 0 },
    ];

    expect(computeQualityAuc(curve)).toBe(0);
  });

  it('should compute correct AUC for multi-point curve', () => {
    const curve: QualityCurvePoint[] = [
      { tokenBudget: 1000, normalizedQuality: 0.2, mrr: 0.2, recallAt10: 0.1, noiseRatio: 0.8 },
      { tokenBudget: 2000, normalizedQuality: 0.6, mrr: 0.6, recallAt10: 0.5, noiseRatio: 0.5 },
      { tokenBudget: 4000, normalizedQuality: 1.0, mrr: 1.0, recallAt10: 0.9, noiseRatio: 0.1 },
    ];

    // Trapezoid 1: (0.2 + 0.6)/2 * 1000 = 400
    // Trapezoid 2: (0.6 + 1.0)/2 * 2000 = 1600
    // Total area: 2000, budget range: 3000
    // AUC: 2000/3000 = 0.6667
    expect(computeQualityAuc(curve)).toBeCloseTo(0.6667, 3);
  });
});
