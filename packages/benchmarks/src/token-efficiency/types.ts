/**
 * Type definitions for the token efficiency benchmarking system.
 *
 * Defines configuration, per-budget results, strategy comparisons,
 * and the overall efficiency report structure.
 */

import type { SingleQueryMetrics } from '../metrics/types.js';

/** A retrieval strategy name used to label benchmark runs. */
export type StrategyName = 'topK' | 'graphExpansion' | 'reranking' | 'budgetOptimized';

/** Configuration for a token efficiency benchmark run. */
export interface TokenBudgetBenchmarkConfig {
  /** Token budgets to evaluate (e.g., [1000, 2000, 4000, 8000, 16000]). */
  readonly tokenBudgets: readonly number[];
  /** Retrieval strategies to compare. */
  readonly strategies: readonly StrategyName[];
  /** Dataset name for report metadata. */
  readonly datasetName: string;
  /** Quality threshold fraction (0-1) for efficiency analysis. Default 0.9. */
  readonly qualityThreshold?: number;
}

/**
 * A retrieval strategy function that returns chunk IDs given a query and token budget.
 * The implementation must respect the token budget limit.
 */
export type StrategyFn = (
  query: string,
  tokenBudget: number,
) => Promise<StrategyResult>;

/** Result from a single strategy execution at a given budget. */
export interface StrategyResult {
  /** Ordered list of retrieved chunk/document IDs. */
  readonly retrievedIds: readonly string[];
  /** Total tokens consumed by the returned chunks. */
  readonly totalTokens: number;
  /** Tokens that belong to relevant chunks (set after evaluation). */
  readonly relevantTokens: number;
  /** Execution duration in milliseconds. */
  readonly durationMs: number;
}

/** Metrics for a single query at a single token budget for a single strategy. */
export interface BudgetQueryResult {
  readonly query: string;
  readonly tokenBudget: number;
  readonly strategy: StrategyName;
  readonly retrievedIds: readonly string[];
  readonly expectedIds: readonly string[];
  readonly totalTokens: number;
  readonly relevantTokens: number;
  readonly noiseRatio: number;
  readonly durationMs: number;
  readonly metrics: SingleQueryMetrics;
}

/** Aggregated metrics for one strategy at one budget level. */
export interface BudgetLevelMetrics {
  readonly tokenBudget: number;
  readonly strategy: StrategyName;
  readonly queryCount: number;
  readonly meanPrecisionAt5: number;
  readonly meanPrecisionAt10: number;
  readonly meanRecallAt5: number;
  readonly meanRecallAt10: number;
  readonly meanMrr: number;
  readonly meanNdcgAt10: number;
  readonly meanNoiseRatio: number;
  readonly meanDurationMs: number;
  readonly meanTotalTokens: number;
}

/** Efficiency analysis result for a single strategy. */
export interface EfficiencyAnalysis {
  readonly strategy: StrategyName;
  /**
   * The minimum token budget at which the strategy reaches the
   * quality threshold fraction of its maximum quality (by MRR).
   * null if never reached.
   */
  readonly tokensFor90PctQuality: number | null;
  /** Maximum MRR achieved at any budget level. */
  readonly maxMrr: number;
  /** Maximum recall@10 achieved at any budget level. */
  readonly maxRecall: number;
  /** Curve of (budget, normalizedQuality) pairs for plotting. */
  readonly qualityCurve: readonly QualityCurvePoint[];
}

/** A single point on the quality-vs-budget curve. */
export interface QualityCurvePoint {
  readonly tokenBudget: number;
  readonly normalizedQuality: number;
  readonly mrr: number;
  readonly recallAt10: number;
  readonly noiseRatio: number;
}

/** Complete token efficiency benchmark report. */
export interface TokenEfficiencyReport {
  readonly metadata: TokenEfficiencyMetadata;
  readonly perBudget: readonly BudgetLevelMetrics[];
  readonly perQuery: readonly BudgetQueryResult[];
  readonly efficiencyAnalysis: readonly EfficiencyAnalysis[];
}

/** Metadata about the benchmark run. */
export interface TokenEfficiencyMetadata {
  readonly datasetName: string;
  readonly timestamp: string;
  readonly tokenBudgets: readonly number[];
  readonly strategies: readonly StrategyName[];
  readonly queryCount: number;
  readonly qualityThreshold: number;
}
