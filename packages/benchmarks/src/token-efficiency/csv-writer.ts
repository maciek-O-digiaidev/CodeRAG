/**
 * CSV report writer for token efficiency benchmarks.
 *
 * Generates CSV output suitable for charting tools (Excel, Google Sheets,
 * matplotlib, etc.) with per-budget metrics for each strategy.
 */

import type {
  BudgetLevelMetrics,
  TokenEfficiencyReport,
  EfficiencyAnalysis,
} from './types.js';

/** CSV column separator. */
const SEP = ',';

/** Decimal precision for numeric values. */
const PRECISION = 4;

/**
 * Generate a CSV string from per-budget metrics.
 *
 * Columns: budget, strategy, precision@5, precision@10, recall@5, recall@10,
 *          mrr, ndcg@10, noise_ratio, mean_tokens, mean_duration_ms
 */
export function writeBudgetMetricsCsv(
  metrics: readonly BudgetLevelMetrics[],
): string {
  const header = [
    'budget',
    'strategy',
    'precision_at_5',
    'precision_at_10',
    'recall_at_5',
    'recall_at_10',
    'mrr',
    'ndcg_at_10',
    'noise_ratio',
    'mean_tokens',
    'mean_duration_ms',
  ].join(SEP);

  const rows = metrics.map((m) =>
    [
      m.tokenBudget,
      m.strategy,
      fmtNum(m.meanPrecisionAt5),
      fmtNum(m.meanPrecisionAt10),
      fmtNum(m.meanRecallAt5),
      fmtNum(m.meanRecallAt10),
      fmtNum(m.meanMrr),
      fmtNum(m.meanNdcgAt10),
      fmtNum(m.meanNoiseRatio),
      fmtNum(m.meanTotalTokens),
      fmtNum(m.meanDurationMs),
    ].join(SEP),
  );

  return [header, ...rows].join('\n');
}

/**
 * Generate a CSV string from the efficiency analysis results.
 *
 * Columns: strategy, tokens_for_90pct_quality, max_mrr, max_recall
 */
export function writeEfficiencyAnalysisCsv(
  analyses: readonly EfficiencyAnalysis[],
): string {
  const header = [
    'strategy',
    'tokens_for_90pct_quality',
    'max_mrr',
    'max_recall',
  ].join(SEP);

  const rows = analyses.map((a) =>
    [
      a.strategy,
      a.tokensFor90PctQuality !== null ? a.tokensFor90PctQuality : 'N/A',
      fmtNum(a.maxMrr),
      fmtNum(a.maxRecall),
    ].join(SEP),
  );

  return [header, ...rows].join('\n');
}

/**
 * Generate a quality curve CSV for a specific strategy.
 *
 * Columns: budget, normalized_quality, mrr, recall_at_10, noise_ratio
 */
export function writeQualityCurveCsv(
  analysis: EfficiencyAnalysis,
): string {
  const header = [
    'budget',
    'normalized_quality',
    'mrr',
    'recall_at_10',
    'noise_ratio',
  ].join(SEP);

  const rows = analysis.qualityCurve.map((p) =>
    [
      p.tokenBudget,
      fmtNum(p.normalizedQuality),
      fmtNum(p.mrr),
      fmtNum(p.recallAt10),
      fmtNum(p.noiseRatio),
    ].join(SEP),
  );

  return [header, ...rows].join('\n');
}

/**
 * Generate a complete CSV report from a TokenEfficiencyReport.
 *
 * Returns a single CSV combining all budget-level metrics across
 * all strategies, suitable for pivot tables and charting.
 */
export function writeFullReportCsv(
  report: TokenEfficiencyReport,
): string {
  return writeBudgetMetricsCsv(report.perBudget);
}

/** Format a number to fixed precision. */
function fmtNum(value: number): string {
  return value.toFixed(PRECISION);
}
