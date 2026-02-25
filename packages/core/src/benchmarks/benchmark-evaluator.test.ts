import { describe, it, expect } from 'vitest';
import {
  computeQueryMetrics,
  computeAggregateMetrics,
  computeQueryTypeBreakdown,
  runBenchmark,
  formatBenchmarkSummary,
  type QueryEvalResult,
} from './benchmark-evaluator.js';
import type { GeneratedQuery } from './query-generator.js';

describe('computeQueryMetrics', () => {
  it('should compute perfect metrics when all expected are at top', () => {
    const retrieved = ['a', 'b', 'c', 'd', 'e'];
    const expected = ['a', 'b'];

    const metrics = computeQueryMetrics(retrieved, expected);
    expect(metrics.precisionAt5).toBe(2 / 5);
    expect(metrics.mrr).toBe(1); // first result is relevant
    expect(metrics.recallAt10).toBe(1); // all expected found
  });

  it('should return zeros when nothing matches', () => {
    const retrieved = ['x', 'y', 'z'];
    const expected = ['a', 'b'];

    const metrics = computeQueryMetrics(retrieved, expected);
    expect(metrics.precisionAt5).toBe(0);
    expect(metrics.precisionAt10).toBe(0);
    expect(metrics.recallAt10).toBe(0);
    expect(metrics.mrr).toBe(0);
    expect(metrics.ndcgAt10).toBe(0);
  });

  it('should handle empty retrieved list', () => {
    const metrics = computeQueryMetrics([], ['a', 'b']);
    expect(metrics.precisionAt5).toBe(0);
    expect(metrics.mrr).toBe(0);
    expect(metrics.recallAt10).toBe(0);
  });

  it('should handle empty expected list', () => {
    const metrics = computeQueryMetrics(['a', 'b'], []);
    expect(metrics.precisionAt5).toBe(0);
    expect(metrics.recallAt10).toBe(0);
    expect(metrics.ndcgAt10).toBe(0);
  });

  it('should compute MRR correctly for second-position hit', () => {
    const retrieved = ['x', 'a', 'y'];
    const expected = ['a'];

    const metrics = computeQueryMetrics(retrieved, expected);
    expect(metrics.mrr).toBe(0.5);
  });

  it('should compute P@5 correctly with partial matches', () => {
    const retrieved = ['a', 'x', 'b', 'y', 'z'];
    const expected = ['a', 'b', 'c'];

    const metrics = computeQueryMetrics(retrieved, expected);
    expect(metrics.precisionAt5).toBe(2 / 5);
  });

  it('should compute nDCG@10 correctly', () => {
    // Only first result is relevant
    const retrieved = ['a', 'x', 'y', 'z', 'w'];
    const expected = ['a'];

    const metrics = computeQueryMetrics(retrieved, expected);
    // DCG = 1/log2(2) = 1, IDCG = 1/log2(2) = 1, nDCG = 1
    expect(metrics.ndcgAt10).toBe(1);
  });
});

describe('computeAggregateMetrics', () => {
  it('should return zeros for empty results', () => {
    const agg = computeAggregateMetrics([]);
    expect(agg.precisionAt5).toBe(0);
    expect(agg.precisionAt10).toBe(0);
    expect(agg.recallAt10).toBe(0);
    expect(agg.mrr).toBe(0);
    expect(agg.ndcgAt10).toBe(0);
    expect(agg.queryCount).toBe(0);
  });

  it('should average metrics correctly', () => {
    const results: QueryEvalResult[] = [
      {
        query: 'q1',
        queryType: 'find-by-name',
        retrievedIds: ['a'],
        expectedIds: ['a'],
        metrics: { precisionAt5: 0.2, precisionAt10: 0.1, recallAt10: 1.0, mrr: 1.0, ndcgAt10: 1.0 },
      },
      {
        query: 'q2',
        queryType: 'find-by-name',
        retrievedIds: ['x'],
        expectedIds: ['a'],
        metrics: { precisionAt5: 0.0, precisionAt10: 0.0, recallAt10: 0.0, mrr: 0.0, ndcgAt10: 0.0 },
      },
    ];

    const agg = computeAggregateMetrics(results);
    expect(agg.precisionAt5).toBe(0.1);
    expect(agg.recallAt10).toBe(0.5);
    expect(agg.mrr).toBe(0.5);
    expect(agg.queryCount).toBe(2);
  });
});

describe('computeQueryTypeBreakdown', () => {
  it('should group by query type', () => {
    const results: QueryEvalResult[] = [
      {
        query: 'q1',
        queryType: 'find-by-name',
        retrievedIds: ['a'],
        expectedIds: ['a'],
        metrics: { precisionAt5: 0.2, precisionAt10: 0.1, recallAt10: 1.0, mrr: 1.0, ndcgAt10: 1.0 },
      },
      {
        query: 'q2',
        queryType: 'find-by-description',
        retrievedIds: ['b'],
        expectedIds: ['b'],
        metrics: { precisionAt5: 0.4, precisionAt10: 0.2, recallAt10: 1.0, mrr: 1.0, ndcgAt10: 1.0 },
      },
      {
        query: 'q3',
        queryType: 'find-by-name',
        retrievedIds: ['x'],
        expectedIds: ['a'],
        metrics: { precisionAt5: 0.0, precisionAt10: 0.0, recallAt10: 0.0, mrr: 0.0, ndcgAt10: 0.0 },
      },
    ];

    const breakdown = computeQueryTypeBreakdown(results);
    expect(breakdown).toHaveLength(2);

    const nameBreakdown = breakdown.find((b) => b.queryType === 'find-by-name');
    expect(nameBreakdown).toBeDefined();
    expect(nameBreakdown!.metrics.queryCount).toBe(2);
    expect(nameBreakdown!.metrics.precisionAt5).toBe(0.1);

    const descBreakdown = breakdown.find((b) => b.queryType === 'find-by-description');
    expect(descBreakdown).toBeDefined();
    expect(descBreakdown!.metrics.queryCount).toBe(1);
    expect(descBreakdown!.metrics.precisionAt5).toBe(0.4);
  });

  it('should return sorted breakdowns', () => {
    const results: QueryEvalResult[] = [
      {
        query: 'q1', queryType: 'find-tests',
        retrievedIds: [], expectedIds: [],
        metrics: { precisionAt5: 0, precisionAt10: 0, recallAt10: 0, mrr: 0, ndcgAt10: 0 },
      },
      {
        query: 'q2', queryType: 'find-by-name',
        retrievedIds: [], expectedIds: [],
        metrics: { precisionAt5: 0, precisionAt10: 0, recallAt10: 0, mrr: 0, ndcgAt10: 0 },
      },
    ];

    const breakdown = computeQueryTypeBreakdown(results);
    expect(breakdown[0]!.queryType).toBe('find-by-name');
    expect(breakdown[1]!.queryType).toBe('find-tests');
  });
});

describe('runBenchmark', () => {
  it('should run queries and compute metrics', async () => {
    const queries: GeneratedQuery[] = [
      { query: 'find parseConfig', expectedChunkIds: ['c1'], queryType: 'find-by-name', sourceEntityId: 'c1' },
      { query: 'find MyClass', expectedChunkIds: ['c2'], queryType: 'find-by-name', sourceEntityId: 'c2' },
    ];

    // Mock search that always returns c1 as first result
    const searchFn = async (_query: string): Promise<readonly string[]> => {
      return ['c1', 'c3', 'c4'];
    };

    const result = await runBenchmark(queries, searchFn, 100);
    expect(result.isOk()).toBe(true);

    const report = result._unsafeUnwrap();
    expect(report.perQuery).toHaveLength(2);
    expect(report.aggregate.queryCount).toBe(2);
    expect(report.metadata.totalQueries).toBe(2);
    expect(report.metadata.totalChunksInIndex).toBe(100);
    expect(report.metadata.durationMs).toBeGreaterThanOrEqual(0);

    // First query should have MRR=1 (c1 found at position 1)
    expect(report.perQuery[0]!.metrics.mrr).toBe(1);
    // Second query should have MRR=0 (c2 not in results)
    expect(report.perQuery[1]!.metrics.mrr).toBe(0);
  });

  it('should call progress callback', async () => {
    const queries: GeneratedQuery[] = [
      { query: 'q1', expectedChunkIds: ['c1'], queryType: 'find-by-name', sourceEntityId: 'c1' },
      { query: 'q2', expectedChunkIds: ['c2'], queryType: 'find-by-name', sourceEntityId: 'c2' },
      { query: 'q3', expectedChunkIds: ['c3'], queryType: 'find-by-name', sourceEntityId: 'c3' },
    ];

    const searchFn = async (): Promise<readonly string[]> => [];
    const progressCalls: [number, number][] = [];

    await runBenchmark(queries, searchFn, 10, (completed, total) => {
      progressCalls.push([completed, total]);
    });

    expect(progressCalls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('should handle search errors gracefully', async () => {
    const queries: GeneratedQuery[] = [
      { query: 'q1', expectedChunkIds: ['c1'], queryType: 'find-by-name', sourceEntityId: 'c1' },
    ];

    const searchFn = async (): Promise<readonly string[]> => {
      throw new Error('Search service unavailable');
    };

    const result = await runBenchmark(queries, searchFn, 10);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Search service unavailable');
  });

  it('should produce correct byQueryType breakdown', async () => {
    const queries: GeneratedQuery[] = [
      { query: 'q1', expectedChunkIds: ['c1'], queryType: 'find-by-name', sourceEntityId: 'c1' },
      { query: 'q2', expectedChunkIds: ['c2'], queryType: 'find-by-description', sourceEntityId: 'c2' },
    ];

    const searchFn = async (): Promise<readonly string[]> => ['c1'];
    const report = (await runBenchmark(queries, searchFn, 10))._unsafeUnwrap();

    expect(report.byQueryType).toHaveLength(2);
    const names = report.byQueryType.map((b) => b.queryType).sort();
    expect(names).toEqual(['find-by-description', 'find-by-name']);
  });
});

describe('formatBenchmarkSummary', () => {
  it('should produce readable text output', () => {
    const report = {
      aggregate: {
        precisionAt5: 0.45,
        precisionAt10: 0.32,
        recallAt10: 0.78,
        mrr: 0.65,
        ndcgAt10: 0.58,
        queryCount: 100,
      },
      byQueryType: [
        {
          queryType: 'find-by-name' as const,
          metrics: {
            precisionAt5: 0.6,
            precisionAt10: 0.4,
            recallAt10: 0.9,
            mrr: 0.8,
            ndcgAt10: 0.7,
            queryCount: 30,
          },
        },
      ],
      perQuery: [],
      metadata: {
        timestamp: '2026-02-25T12:00:00.000Z',
        totalQueries: 100,
        totalChunksInIndex: 500,
        durationMs: 5432,
      },
    };

    const summary = formatBenchmarkSummary(report);
    expect(summary).toContain('Benchmark Results');
    expect(summary).toContain('100');
    expect(summary).toContain('500 chunks');
    expect(summary).toContain('5.4s');
    expect(summary).toContain('0.4500');
    expect(summary).toContain('0.6500');
    expect(summary).toContain('find-by-name');
    expect(summary).toContain('By Query Type:');
  });

  it('should handle report with no query type breakdown', () => {
    const report = {
      aggregate: {
        precisionAt5: 0,
        precisionAt10: 0,
        recallAt10: 0,
        mrr: 0,
        ndcgAt10: 0,
        queryCount: 0,
      },
      byQueryType: [],
      perQuery: [],
      metadata: {
        timestamp: '2026-02-25T12:00:00.000Z',
        totalQueries: 0,
        totalChunksInIndex: 0,
        durationMs: 0,
      },
    };

    const summary = formatBenchmarkSummary(report);
    expect(summary).toContain('Benchmark Results');
    expect(summary).not.toContain('By Query Type:');
  });
});
