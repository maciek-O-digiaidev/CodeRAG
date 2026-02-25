/**
 * Efficiency analyzer for token budget benchmarks.
 *
 * Analyzes per-budget metrics to determine:
 * 1. The "90% quality threshold" — minimum tokens needed to reach 90% of max quality
 * 2. Quality-vs-budget curves for plotting and comparison
 * 3. Strategy comparison summaries
 */

import type {
  BudgetLevelMetrics,
  EfficiencyAnalysis,
  QualityCurvePoint,
  StrategyName,
} from './types.js';

/** Default quality threshold: 90% of maximum quality. */
const DEFAULT_QUALITY_THRESHOLD = 0.9;

/**
 * Analyze efficiency for all strategies across budget levels.
 *
 * For each strategy, finds the minimum token budget at which quality
 * reaches the threshold fraction of the strategy's maximum quality.
 *
 * @param perBudget - Aggregated metrics per budget level and strategy.
 * @param qualityThreshold - Fraction of max quality to target (0-1). Default 0.9.
 */
export function analyzeEfficiency(
  perBudget: readonly BudgetLevelMetrics[],
  qualityThreshold: number = DEFAULT_QUALITY_THRESHOLD,
): readonly EfficiencyAnalysis[] {
  const strategies = getUniqueStrategies(perBudget);
  return strategies.map((strategy) =>
    analyzeStrategyEfficiency(
      perBudget.filter((m) => m.strategy === strategy),
      strategy,
      qualityThreshold,
    ),
  );
}

/**
 * Analyze efficiency for a single strategy.
 *
 * Computes the quality curve and identifies the budget where the
 * quality threshold is first reached.
 */
export function analyzeStrategyEfficiency(
  strategyMetrics: readonly BudgetLevelMetrics[],
  strategy: StrategyName,
  qualityThreshold: number = DEFAULT_QUALITY_THRESHOLD,
): EfficiencyAnalysis {
  if (strategyMetrics.length === 0) {
    return {
      strategy,
      tokensFor90PctQuality: null,
      maxMrr: 0,
      maxRecall: 0,
      qualityCurve: [],
    };
  }

  // Sort by token budget ascending for monotonic curve analysis
  const sorted = [...strategyMetrics].sort(
    (a, b) => a.tokenBudget - b.tokenBudget,
  );

  // Find max quality metrics
  const maxMrr = Math.max(...sorted.map((m) => m.meanMrr));
  const maxRecall = Math.max(...sorted.map((m) => m.meanRecallAt10));

  // Build the quality curve
  const qualityCurve: QualityCurvePoint[] = sorted.map((m) => ({
    tokenBudget: m.tokenBudget,
    normalizedQuality: maxMrr > 0 ? m.meanMrr / maxMrr : 0,
    mrr: m.meanMrr,
    recallAt10: m.meanRecallAt10,
    noiseRatio: m.meanNoiseRatio,
  }));

  // Find the first budget where quality >= threshold * max
  const targetQuality = qualityThreshold * maxMrr;
  const thresholdPoint = sorted.find((m) => m.meanMrr >= targetQuality);
  const tokensFor90PctQuality = thresholdPoint?.tokenBudget ?? null;

  return {
    strategy,
    tokensFor90PctQuality,
    maxMrr,
    maxRecall,
    qualityCurve,
  };
}

/**
 * Compare strategies by their token efficiency.
 *
 * Returns strategies sorted by their 90% quality threshold (ascending),
 * meaning the most efficient strategy (fewest tokens needed) comes first.
 * Strategies that never reach the threshold are sorted last.
 */
export function rankStrategiesByEfficiency(
  analyses: readonly EfficiencyAnalysis[],
): readonly EfficiencyAnalysis[] {
  return [...analyses].sort((a, b) => {
    // Strategies that never reach threshold go last
    if (a.tokensFor90PctQuality === null && b.tokensFor90PctQuality === null) {
      // Tie-break by max quality
      return b.maxMrr - a.maxMrr;
    }
    if (a.tokensFor90PctQuality === null) return 1;
    if (b.tokensFor90PctQuality === null) return -1;
    return a.tokensFor90PctQuality - b.tokensFor90PctQuality;
  });
}

/**
 * Compute the area under the quality curve (AUC) for a strategy.
 * Higher AUC means the strategy achieves good quality across more budget levels.
 * Uses trapezoidal rule on the normalized quality curve.
 *
 * Returns 0 for empty curves.
 */
export function computeQualityAuc(
  curve: readonly QualityCurvePoint[],
): number {
  if (curve.length < 2) return 0;

  let auc = 0;
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]!;
    const curr = curve[i]!;
    const width = curr.tokenBudget - prev.tokenBudget;
    const height = (prev.normalizedQuality + curr.normalizedQuality) / 2;
    auc += width * height;
  }

  // Normalize by total budget range for a 0-1 score
  const budgetRange =
    curve[curve.length - 1]!.tokenBudget - curve[0]!.tokenBudget;
  return budgetRange > 0 ? auc / budgetRange : 0;
}

/** Extract unique strategy names from budget-level metrics, preserving order. */
function getUniqueStrategies(
  metrics: readonly BudgetLevelMetrics[],
): StrategyName[] {
  const seen = new Set<StrategyName>();
  const result: StrategyName[] = [];
  for (const m of metrics) {
    if (!seen.has(m.strategy)) {
      seen.add(m.strategy);
      result.push(m.strategy);
    }
  }
  return result;
}
