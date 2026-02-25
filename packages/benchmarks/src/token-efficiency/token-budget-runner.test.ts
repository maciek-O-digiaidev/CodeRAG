import { describe, it, expect, vi } from 'vitest';
import {
  runTokenBudgetBenchmark,
  aggregateBudgetMetrics,
} from './token-budget-runner.js';
import type { StrategyMap } from './token-budget-runner.js';
import type { GenericBenchmarkDataset } from '../metrics/types.js';
import type {
  TokenBudgetBenchmarkConfig,
  StrategyFn,
  StrategyName,
  BudgetQueryResult,
} from './types.js';

/** Helper to create a mock dataset. */
function makeDataset(queries: string[], expectedIds: string[][]): GenericBenchmarkDataset {
  return {
    queries: queries.map((q, i) => ({
      query: q,
      expectedChunkIds: expectedIds[i] ?? [],
    })),
  };
}

/** Helper to create a mock strategy that returns given IDs. */
function makeMockStrategy(
  retrievedIds: readonly string[],
  totalTokens: number,
  relevantTokens: number,
): StrategyFn {
  return vi.fn(async (_query: string, _budget: number) => ({
    retrievedIds,
    totalTokens,
    relevantTokens,
    durationMs: 10,
  }));
}

describe('runTokenBudgetBenchmark', () => {
  it('should run all strategy/budget/query combinations', async () => {
    const dataset = makeDataset(
      ['find auth module', 'search function'],
      [['auth.ts'], ['search.ts']],
    );

    const topKFn = makeMockStrategy(['auth.ts', 'other.ts'], 500, 250);
    const rerankFn = makeMockStrategy(['auth.ts'], 300, 300);

    const strategies: StrategyMap = new Map<StrategyName, StrategyFn>([
      ['topK', topKFn],
      ['reranking', rerankFn],
    ]);

    const config: TokenBudgetBenchmarkConfig = {
      tokenBudgets: [1000, 2000],
      strategies: ['topK', 'reranking'],
      datasetName: 'test-dataset',
    };

    const report = await runTokenBudgetBenchmark(dataset, strategies, config);

    // 2 strategies * 2 budgets * 2 queries = 8 per-query results
    expect(report.perQuery).toHaveLength(8);
    expect(report.metadata.datasetName).toBe('test-dataset');
    expect(report.metadata.queryCount).toBe(2);
    expect(report.metadata.strategies).toEqual(['topK', 'reranking']);
    expect(report.metadata.tokenBudgets).toEqual([1000, 2000]);
    expect(report.metadata.qualityThreshold).toBe(0.9);

    // Should have called each strategy fn for each budget/query combo
    expect(topKFn).toHaveBeenCalledTimes(4); // 2 budgets * 2 queries
    expect(rerankFn).toHaveBeenCalledTimes(4);
  });

  it('should compute per-budget aggregated metrics', async () => {
    const dataset = makeDataset(
      ['query1'],
      [['a.ts', 'b.ts']],
    );

    const strategyFn = makeMockStrategy(['a.ts', 'b.ts', 'c.ts'], 600, 400);
    const strategies: StrategyMap = new Map<StrategyName, StrategyFn>([
      ['topK', strategyFn],
    ]);

    const config: TokenBudgetBenchmarkConfig = {
      tokenBudgets: [2000, 4000],
      strategies: ['topK'],
      datasetName: 'test',
    };

    const report = await runTokenBudgetBenchmark(dataset, strategies, config);

    // 1 strategy * 2 budgets * 1 query = 2 per-query
    expect(report.perQuery).toHaveLength(2);
    // 2 budget levels for 1 strategy
    expect(report.perBudget).toHaveLength(2);

    const firstBudget = report.perBudget.find((m) => m.tokenBudget === 2000);
    expect(firstBudget).toBeDefined();
    expect(firstBudget!.strategy).toBe('topK');
    expect(firstBudget!.queryCount).toBe(1);
  });

  it('should compute noise ratio from strategy results', async () => {
    const dataset = makeDataset(['find foo'], [['foo.ts']]);

    const strategyFn = makeMockStrategy(['foo.ts', 'bar.ts'], 100, 50);
    const strategies: StrategyMap = new Map<StrategyName, StrategyFn>([
      ['topK', strategyFn],
    ]);

    const config: TokenBudgetBenchmarkConfig = {
      tokenBudgets: [1000],
      strategies: ['topK'],
      datasetName: 'test',
    };

    const report = await runTokenBudgetBenchmark(dataset, strategies, config);

    // noise ratio = 1 - 50/100 = 0.5
    expect(report.perQuery[0]!.noiseRatio).toBeCloseTo(0.5);
  });

  it('should skip missing strategy functions', async () => {
    const dataset = makeDataset(['query'], [['a.ts']]);

    const topKFn = makeMockStrategy(['a.ts'], 100, 100);
    const strategies: StrategyMap = new Map<StrategyName, StrategyFn>([
      ['topK', topKFn],
      // 'reranking' is NOT in the map
    ]);

    const config: TokenBudgetBenchmarkConfig = {
      tokenBudgets: [1000],
      strategies: ['topK', 'reranking'],
      datasetName: 'test',
    };

    const report = await runTokenBudgetBenchmark(dataset, strategies, config);

    // Only topK results (reranking skipped because fn not in map)
    expect(report.perQuery).toHaveLength(1);
    expect(report.perQuery[0]!.strategy).toBe('topK');
  });

  it('should include efficiency analysis in report', async () => {
    const dataset = makeDataset(['query'], [['a.ts']]);

    const strategyFn = makeMockStrategy(['a.ts'], 200, 200);
    const strategies: StrategyMap = new Map<StrategyName, StrategyFn>([
      ['topK', strategyFn],
    ]);

    const config: TokenBudgetBenchmarkConfig = {
      tokenBudgets: [1000, 2000],
      strategies: ['topK'],
      datasetName: 'test',
    };

    const report = await runTokenBudgetBenchmark(dataset, strategies, config);

    expect(report.efficiencyAnalysis).toHaveLength(1);
    expect(report.efficiencyAnalysis[0]!.strategy).toBe('topK');
  });

  it('should use custom quality threshold', async () => {
    const dataset = makeDataset(['query'], [['a.ts']]);

    const strategyFn = makeMockStrategy(['a.ts'], 200, 200);
    const strategies: StrategyMap = new Map<StrategyName, StrategyFn>([
      ['topK', strategyFn],
    ]);

    const config: TokenBudgetBenchmarkConfig = {
      tokenBudgets: [1000],
      strategies: ['topK'],
      datasetName: 'test',
      qualityThreshold: 0.8,
    };

    const report = await runTokenBudgetBenchmark(dataset, strategies, config);

    expect(report.metadata.qualityThreshold).toBe(0.8);
  });

  it('should pass correct budget to strategy function', async () => {
    const dataset = makeDataset(['query'], [['a.ts']]);

    const budgets: number[] = [];
    const strategyFn: StrategyFn = async (_query, budget) => {
      budgets.push(budget);
      return { retrievedIds: ['a.ts'], totalTokens: 100, relevantTokens: 100, durationMs: 5 };
    };

    const strategies: StrategyMap = new Map<StrategyName, StrategyFn>([
      ['topK', strategyFn],
    ]);

    const config: TokenBudgetBenchmarkConfig = {
      tokenBudgets: [1000, 4000, 8000],
      strategies: ['topK'],
      datasetName: 'test',
    };

    await runTokenBudgetBenchmark(dataset, strategies, config);

    expect(budgets).toEqual([1000, 4000, 8000]);
  });
});

describe('aggregateBudgetMetrics', () => {
  it('should aggregate metrics by strategy and budget', () => {
    const results: BudgetQueryResult[] = [
      {
        query: 'q1',
        tokenBudget: 1000,
        strategy: 'topK',
        retrievedIds: ['a'],
        expectedIds: ['a'],
        totalTokens: 100,
        relevantTokens: 100,
        noiseRatio: 0,
        durationMs: 10,
        metrics: {
          precisionAt5: 0.2, precisionAt10: 0.1,
          recallAt5: 0.5, recallAt10: 1.0,
          mrr: 1.0, ndcgAt10: 1.0,
          map: 1.0, contextPrecision: 1.0, contextRecall: null,
        },
      },
      {
        query: 'q2',
        tokenBudget: 1000,
        strategy: 'topK',
        retrievedIds: ['b'],
        expectedIds: ['a'],
        totalTokens: 100,
        relevantTokens: 0,
        noiseRatio: 1,
        durationMs: 20,
        metrics: {
          precisionAt5: 0, precisionAt10: 0,
          recallAt5: 0, recallAt10: 0,
          mrr: 0, ndcgAt10: 0,
          map: 0, contextPrecision: 0, contextRecall: null,
        },
      },
    ];

    const aggregated = aggregateBudgetMetrics(results);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]!.strategy).toBe('topK');
    expect(aggregated[0]!.tokenBudget).toBe(1000);
    expect(aggregated[0]!.queryCount).toBe(2);
    expect(aggregated[0]!.meanMrr).toBe(0.5);
    expect(aggregated[0]!.meanNoiseRatio).toBe(0.5);
    expect(aggregated[0]!.meanDurationMs).toBe(15);
    expect(aggregated[0]!.meanPrecisionAt5).toBe(0.1);
  });

  it('should separate different strategies', () => {
    const results: BudgetQueryResult[] = [
      {
        query: 'q1',
        tokenBudget: 1000,
        strategy: 'topK',
        retrievedIds: ['a'],
        expectedIds: ['a'],
        totalTokens: 100,
        relevantTokens: 100,
        noiseRatio: 0,
        durationMs: 10,
        metrics: {
          precisionAt5: 0.2, precisionAt10: 0.1,
          recallAt5: 0.5, recallAt10: 1.0,
          mrr: 1.0, ndcgAt10: 1.0,
          map: 1.0, contextPrecision: 1.0, contextRecall: null,
        },
      },
      {
        query: 'q1',
        tokenBudget: 1000,
        strategy: 'reranking',
        retrievedIds: ['a'],
        expectedIds: ['a'],
        totalTokens: 80,
        relevantTokens: 80,
        noiseRatio: 0,
        durationMs: 15,
        metrics: {
          precisionAt5: 0.2, precisionAt10: 0.1,
          recallAt5: 0.5, recallAt10: 1.0,
          mrr: 1.0, ndcgAt10: 1.0,
          map: 1.0, contextPrecision: 1.0, contextRecall: null,
        },
      },
    ];

    const aggregated = aggregateBudgetMetrics(results);

    expect(aggregated).toHaveLength(2);
    const strategies = aggregated.map((a) => a.strategy);
    expect(strategies).toContain('topK');
    expect(strategies).toContain('reranking');
  });

  it('should separate different budget levels', () => {
    const makeResult = (budget: number): BudgetQueryResult => ({
      query: 'q1',
      tokenBudget: budget,
      strategy: 'topK',
      retrievedIds: ['a'],
      expectedIds: ['a'],
      totalTokens: budget / 2,
      relevantTokens: budget / 4,
      noiseRatio: 0.5,
      durationMs: 10,
      metrics: {
        precisionAt5: 0.2, precisionAt10: 0.1,
        recallAt5: 0.5, recallAt10: 1.0,
        mrr: 1.0, ndcgAt10: 1.0,
        map: 1.0, contextPrecision: 1.0, contextRecall: null,
      },
    });

    const results = [makeResult(1000), makeResult(2000)];
    const aggregated = aggregateBudgetMetrics(results);

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0]!.tokenBudget).toBe(1000);
    expect(aggregated[1]!.tokenBudget).toBe(2000);
  });

  it('should return empty array for no results', () => {
    expect(aggregateBudgetMetrics([])).toHaveLength(0);
  });

  it('should sort by strategy name then budget ascending', () => {
    const results: BudgetQueryResult[] = [
      {
        query: 'q',
        tokenBudget: 4000,
        strategy: 'topK',
        retrievedIds: [],
        expectedIds: [],
        totalTokens: 0,
        relevantTokens: 0,
        noiseRatio: 0,
        durationMs: 1,
        metrics: {
          precisionAt5: 0, precisionAt10: 0,
          recallAt5: 0, recallAt10: 0,
          mrr: 0, ndcgAt10: 0,
          map: 0, contextPrecision: 0, contextRecall: null,
        },
      },
      {
        query: 'q',
        tokenBudget: 1000,
        strategy: 'topK',
        retrievedIds: [],
        expectedIds: [],
        totalTokens: 0,
        relevantTokens: 0,
        noiseRatio: 0,
        durationMs: 1,
        metrics: {
          precisionAt5: 0, precisionAt10: 0,
          recallAt5: 0, recallAt10: 0,
          mrr: 0, ndcgAt10: 0,
          map: 0, contextPrecision: 0, contextRecall: null,
        },
      },
      {
        query: 'q',
        tokenBudget: 1000,
        strategy: 'budgetOptimized',
        retrievedIds: [],
        expectedIds: [],
        totalTokens: 0,
        relevantTokens: 0,
        noiseRatio: 0,
        durationMs: 1,
        metrics: {
          precisionAt5: 0, precisionAt10: 0,
          recallAt5: 0, recallAt10: 0,
          mrr: 0, ndcgAt10: 0,
          map: 0, contextPrecision: 0, contextRecall: null,
        },
      },
    ];

    const aggregated = aggregateBudgetMetrics(results);

    // budgetOptimized < topK alphabetically
    expect(aggregated[0]!.strategy).toBe('budgetOptimized');
    expect(aggregated[1]!.strategy).toBe('topK');
    expect(aggregated[1]!.tokenBudget).toBe(1000);
    expect(aggregated[2]!.strategy).toBe('topK');
    expect(aggregated[2]!.tokenBudget).toBe(4000);
  });
});
