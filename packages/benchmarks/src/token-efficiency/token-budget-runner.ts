/**
 * Token budget benchmark runner.
 *
 * Orchestrates benchmark runs across multiple token budgets and retrieval
 * strategies, computing quality metrics and noise ratios at each level.
 *
 * The runner:
 * 1. Iterates over all (strategy, budget) combinations
 * 2. Runs each query with the given strategy and budget
 * 3. Computes IR metrics and noise ratio for each result
 * 4. Aggregates metrics per budget level
 * 5. Delegates efficiency analysis to the analyzer
 */

import { computeSingleQueryMetrics } from '../metrics/metrics-runner.js';
import type { GenericBenchmarkDataset } from '../metrics/types.js';
import { computeNoiseRatio } from './noise-calculator.js';
import { analyzeEfficiency } from './efficiency-analyzer.js';
import type {
  TokenBudgetBenchmarkConfig,
  StrategyFn,
  StrategyName,
  BudgetQueryResult,
  BudgetLevelMetrics,
  TokenEfficiencyReport,
} from './types.js';

/** Default quality threshold for the efficiency analysis. */
const DEFAULT_QUALITY_THRESHOLD = 0.9;

/** Map of strategy name to its function implementation. */
export type StrategyMap = ReadonlyMap<StrategyName, StrategyFn>;

/**
 * Run the token efficiency benchmark.
 *
 * For each strategy in the config, runs every query at every budget level
 * and computes quality metrics and noise ratios.
 *
 * @param dataset - Benchmark queries with expected relevant IDs.
 * @param strategies - Map from strategy name to its retrieval function.
 * @param config - Benchmark configuration (budgets, strategy names, etc.).
 * @returns Complete token efficiency report.
 */
export async function runTokenBudgetBenchmark(
  dataset: GenericBenchmarkDataset,
  strategies: StrategyMap,
  config: TokenBudgetBenchmarkConfig,
): Promise<TokenEfficiencyReport> {
  const qualityThreshold = config.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD;
  const perQuery: BudgetQueryResult[] = [];

  for (const strategyName of config.strategies) {
    const strategyFn = strategies.get(strategyName);
    if (!strategyFn) {
      continue;
    }

    for (const budget of config.tokenBudgets) {
      for (const query of dataset.queries) {
        const expectedIds = query.expectedChunkIds;
        const expectedSet = new Set(expectedIds);

        const result = await strategyFn(query.query, budget);

        const noiseRatio = computeNoiseRatio(
          result.relevantTokens,
          result.totalTokens,
        );

        const metrics = computeSingleQueryMetrics(
          result.retrievedIds,
          expectedIds,
        );

        perQuery.push({
          query: query.query,
          tokenBudget: budget,
          strategy: strategyName,
          retrievedIds: result.retrievedIds,
          expectedIds: [...expectedSet],
          totalTokens: result.totalTokens,
          relevantTokens: result.relevantTokens,
          noiseRatio,
          durationMs: result.durationMs,
          metrics,
        });
      }
    }
  }

  const perBudget = aggregateBudgetMetrics(perQuery);
  const efficiencyAnalysis = analyzeEfficiency(perBudget, qualityThreshold);

  return {
    metadata: {
      datasetName: config.datasetName,
      timestamp: new Date().toISOString(),
      tokenBudgets: config.tokenBudgets,
      strategies: config.strategies,
      queryCount: dataset.queries.length,
      qualityThreshold,
    },
    perBudget,
    perQuery,
    efficiencyAnalysis,
  };
}

/**
 * Aggregate per-query results into per-budget-level metrics.
 *
 * Groups by (strategy, tokenBudget) and computes mean metrics.
 */
export function aggregateBudgetMetrics(
  queryResults: readonly BudgetQueryResult[],
): BudgetLevelMetrics[] {
  const groups = new Map<string, BudgetQueryResult[]>();

  for (const result of queryResults) {
    const key = `${result.strategy}:${result.tokenBudget}`;
    const group = groups.get(key);
    if (group) {
      group.push(result);
    } else {
      groups.set(key, [result]);
    }
  }

  const aggregated: BudgetLevelMetrics[] = [];

  for (const results of groups.values()) {
    if (results.length === 0) continue;
    const first = results[0]!;
    const count = results.length;

    let sumP5 = 0;
    let sumP10 = 0;
    let sumR5 = 0;
    let sumR10 = 0;
    let sumMrr = 0;
    let sumNdcg = 0;
    let sumNoise = 0;
    let sumDuration = 0;
    let sumTokens = 0;

    for (const r of results) {
      sumP5 += r.metrics.precisionAt5;
      sumP10 += r.metrics.precisionAt10;
      sumR5 += r.metrics.recallAt5;
      sumR10 += r.metrics.recallAt10;
      sumMrr += r.metrics.mrr;
      sumNdcg += r.metrics.ndcgAt10;
      sumNoise += r.noiseRatio;
      sumDuration += r.durationMs;
      sumTokens += r.totalTokens;
    }

    aggregated.push({
      tokenBudget: first.tokenBudget,
      strategy: first.strategy,
      queryCount: count,
      meanPrecisionAt5: sumP5 / count,
      meanPrecisionAt10: sumP10 / count,
      meanRecallAt5: sumR5 / count,
      meanRecallAt10: sumR10 / count,
      meanMrr: sumMrr / count,
      meanNdcgAt10: sumNdcg / count,
      meanNoiseRatio: sumNoise / count,
      meanDurationMs: sumDuration / count,
      meanTotalTokens: sumTokens / count,
    });
  }

  // Sort by strategy name then by budget ascending
  aggregated.sort((a, b) => {
    if (a.strategy !== b.strategy) {
      return a.strategy.localeCompare(b.strategy);
    }
    return a.tokenBudget - b.tokenBudget;
  });

  return aggregated;
}
