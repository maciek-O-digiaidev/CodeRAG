import { describe, it, expect } from 'vitest';
import {
  precisionAtK,
  recallAtK,
  meanReciprocalRank,
  ndcg,
} from './metrics.js';
import { parseGrepOutput, rankByOccurrence } from './runners/grep-runner.js';
import {
  computeQueryMetrics,
  computeAggregateMetrics,
  generateMarkdownReport,
  extractRelevantPaths,
} from './benchmark.js';
import type { BenchmarkQuery, BenchmarkReport, QueryRunResult } from './types.js';

// --- Precision@K Tests ---

describe('precisionAtK', () => {
  it('should return 1.0 when all retrieved are relevant', () => {
    const retrieved = ['a.ts', 'b.ts', 'c.ts'];
    const relevant = ['a.ts', 'b.ts', 'c.ts'];
    expect(precisionAtK(retrieved, relevant, 3)).toBe(1.0);
  });

  it('should return 0.0 when none retrieved are relevant', () => {
    const retrieved = ['x.ts', 'y.ts', 'z.ts'];
    const relevant = ['a.ts', 'b.ts'];
    expect(precisionAtK(retrieved, relevant, 3)).toBe(0.0);
  });

  it('should return correct fraction for partial match', () => {
    const retrieved = ['a.ts', 'x.ts', 'b.ts', 'y.ts'];
    const relevant = ['a.ts', 'b.ts'];
    expect(precisionAtK(retrieved, relevant, 4)).toBe(0.5);
  });

  it('should only consider top-k items', () => {
    const retrieved = ['a.ts', 'x.ts', 'b.ts'];
    const relevant = ['a.ts', 'b.ts'];
    // At k=2, only ['a.ts', 'x.ts'] are considered, 1 hit out of 2
    expect(precisionAtK(retrieved, relevant, 2)).toBe(0.5);
  });

  it('should return 0 for k <= 0', () => {
    expect(precisionAtK(['a.ts'], ['a.ts'], 0)).toBe(0);
    expect(precisionAtK(['a.ts'], ['a.ts'], -1)).toBe(0);
  });

  it('should return 0 for empty retrieved', () => {
    expect(precisionAtK([], ['a.ts'], 5)).toBe(0);
  });

  it('should penalize when retrieved count is less than k', () => {
    const retrieved = ['a.ts', 'b.ts'];
    const relevant = ['a.ts', 'b.ts'];
    // Standard P@K: 2 hits / k=10 = 0.2 (penalizes returning fewer than k)
    expect(precisionAtK(retrieved, relevant, 10)).toBe(0.2);
  });
});

// --- Recall@K Tests ---

describe('recallAtK', () => {
  it('should return 1.0 when all relevant are retrieved', () => {
    const retrieved = ['a.ts', 'b.ts', 'c.ts'];
    const relevant = ['a.ts', 'b.ts'];
    expect(recallAtK(retrieved, relevant, 3)).toBe(1.0);
  });

  it('should return 0.0 when no relevant are retrieved', () => {
    const retrieved = ['x.ts', 'y.ts'];
    const relevant = ['a.ts', 'b.ts'];
    expect(recallAtK(retrieved, relevant, 2)).toBe(0.0);
  });

  it('should return correct fraction', () => {
    const retrieved = ['a.ts', 'x.ts', 'y.ts'];
    const relevant = ['a.ts', 'b.ts'];
    expect(recallAtK(retrieved, relevant, 3)).toBe(0.5);
  });

  it('should return 0 for empty relevant', () => {
    expect(recallAtK(['a.ts'], [], 5)).toBe(0);
  });

  it('should return 0 for k <= 0', () => {
    expect(recallAtK(['a.ts'], ['a.ts'], 0)).toBe(0);
  });
});

// --- MRR Tests ---

describe('meanReciprocalRank', () => {
  it('should return 1.0 when first result is relevant', () => {
    const retrieved = ['a.ts', 'b.ts', 'c.ts'];
    const relevant = ['a.ts'];
    expect(meanReciprocalRank(retrieved, relevant)).toBe(1.0);
  });

  it('should return 0.5 when second result is first relevant', () => {
    const retrieved = ['x.ts', 'a.ts', 'b.ts'];
    const relevant = ['a.ts'];
    expect(meanReciprocalRank(retrieved, relevant)).toBe(0.5);
  });

  it('should return 1/3 when third result is first relevant', () => {
    const retrieved = ['x.ts', 'y.ts', 'a.ts'];
    const relevant = ['a.ts'];
    expect(meanReciprocalRank(retrieved, relevant)).toBeCloseTo(1 / 3);
  });

  it('should return 0 when no relevant result is found', () => {
    const retrieved = ['x.ts', 'y.ts'];
    const relevant = ['a.ts'];
    expect(meanReciprocalRank(retrieved, relevant)).toBe(0);
  });

  it('should return 0 for empty retrieved', () => {
    expect(meanReciprocalRank([], ['a.ts'])).toBe(0);
  });

  it('should find the first relevant among multiple', () => {
    const retrieved = ['x.ts', 'a.ts', 'b.ts'];
    const relevant = ['a.ts', 'b.ts'];
    // First relevant is at rank 2
    expect(meanReciprocalRank(retrieved, relevant)).toBe(0.5);
  });
});

// --- nDCG Tests ---

describe('ndcg', () => {
  it('should return 1.0 for perfect ranking', () => {
    const retrieved = ['a.ts', 'b.ts'];
    const relevant = ['a.ts', 'b.ts'];
    expect(ndcg(retrieved, relevant, 2)).toBeCloseTo(1.0);
  });

  it('should return 0 for no relevant results', () => {
    const retrieved = ['x.ts', 'y.ts'];
    const relevant = ['a.ts'];
    expect(ndcg(retrieved, relevant, 2)).toBe(0);
  });

  it('should return less than 1.0 for imperfect ranking', () => {
    // Relevant item is at position 2 instead of 1
    const retrieved = ['x.ts', 'a.ts'];
    const relevant = ['a.ts'];
    const result = ndcg(retrieved, relevant, 2);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it('should return 0 for k <= 0', () => {
    expect(ndcg(['a.ts'], ['a.ts'], 0)).toBe(0);
  });

  it('should return 0 for empty relevant', () => {
    expect(ndcg(['a.ts'], [], 5)).toBe(0);
  });

  it('should handle k larger than retrieved', () => {
    const retrieved = ['a.ts'];
    const relevant = ['a.ts'];
    expect(ndcg(retrieved, relevant, 10)).toBeCloseTo(1.0);
  });

  it('should penalize later relevant results', () => {
    const relevant = ['a.ts', 'b.ts'];
    // Perfect order
    const perfect = ndcg(['a.ts', 'b.ts', 'x.ts'], relevant, 3);
    // Swapped: relevant items at positions 2 and 3
    const swapped = ndcg(['x.ts', 'a.ts', 'b.ts'], relevant, 3);
    expect(perfect).toBeGreaterThan(swapped);
  });
});

// --- Grep Output Parsing Tests ---

describe('parseGrepOutput', () => {
  it('should parse grep output into file counts', () => {
    const output = [
      'src/foo.ts:10:const x = 1;',
      'src/foo.ts:20:const y = 2;',
      'src/bar.ts:5:import x from "foo";',
    ].join('\n');

    const counts = parseGrepOutput(output);
    expect(counts.get('src/foo.ts')).toBe(2);
    expect(counts.get('src/bar.ts')).toBe(1);
  });

  it('should return empty map for empty output', () => {
    const counts = parseGrepOutput('');
    expect(counts.size).toBe(0);
  });

  it('should return empty map for whitespace only', () => {
    const counts = parseGrepOutput('   \n  \n  ');
    expect(counts.size).toBe(0);
  });

  it('should handle lines without colons', () => {
    const counts = parseGrepOutput('no-colon-line');
    expect(counts.size).toBe(0);
  });

  it('should handle paths with colons in content', () => {
    const output = 'src/foo.ts:10:const url = "http://example.com";';
    const counts = parseGrepOutput(output);
    expect(counts.get('src/foo.ts')).toBe(1);
  });
});

describe('rankByOccurrence', () => {
  it('should rank files by match count descending', () => {
    const counts = new Map<string, number>([
      ['a.ts', 1],
      ['b.ts', 5],
      ['c.ts', 3],
    ]);
    const ranked = rankByOccurrence(counts);
    expect(ranked).toEqual(['b.ts', 'c.ts', 'a.ts']);
  });

  it('should return empty array for empty map', () => {
    expect(rankByOccurrence(new Map())).toEqual([]);
  });
});

// --- Benchmark Helpers Tests ---

describe('extractRelevantPaths', () => {
  it('should extract file paths from expected chunks', () => {
    const query: BenchmarkQuery = {
      id: 'test-001',
      query: 'test query',
      difficulty: 'easy',
      category: 'function_lookup',
      expectedChunks: [
        {
          filePath: 'src/foo.ts',
          chunkType: 'function',
          name: 'foo',
          relevance: 'primary',
        },
        {
          filePath: 'src/bar.ts',
          chunkType: 'class',
          name: 'Bar',
          relevance: 'secondary',
        },
      ],
      tags: ['test'],
    };

    expect(extractRelevantPaths(query)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });
});

describe('computeQueryMetrics', () => {
  it('should compute all metrics for a query', () => {
    const retrieved = ['a.ts', 'b.ts', 'c.ts'];
    const relevant = ['a.ts', 'c.ts'];
    const metrics = computeQueryMetrics(retrieved, relevant);

    expect(metrics.precisionAt5).toBeGreaterThan(0);
    expect(metrics.recallAt5).toBeGreaterThan(0);
    expect(metrics.mrr).toBe(1.0);
    expect(metrics.ndcgAt10).toBeGreaterThan(0);
  });
});

describe('computeAggregateMetrics', () => {
  it('should average metrics across query results', () => {
    const results: QueryRunResult[] = [
      {
        queryId: 'q1',
        query: 'test 1',
        retrievedPaths: ['a.ts'],
        relevantPaths: ['a.ts'],
        durationMs: 10,
        metrics: {
          precisionAt5: 1.0,
          precisionAt10: 1.0,
          recallAt5: 1.0,
          recallAt10: 1.0,
          mrr: 1.0,
          ndcgAt10: 1.0,
        },
      },
      {
        queryId: 'q2',
        query: 'test 2',
        retrievedPaths: ['x.ts'],
        relevantPaths: ['a.ts'],
        durationMs: 20,
        metrics: {
          precisionAt5: 0.0,
          precisionAt10: 0.0,
          recallAt5: 0.0,
          recallAt10: 0.0,
          mrr: 0.0,
          ndcgAt10: 0.0,
        },
      },
    ];

    const agg = computeAggregateMetrics(results);
    expect(agg.precisionAt5).toBe(0.5);
    expect(agg.mrr).toBe(0.5);
  });

  it('should return zeros for empty results', () => {
    const agg = computeAggregateMetrics([]);
    expect(agg.precisionAt5).toBe(0);
    expect(agg.mrr).toBe(0);
  });
});

// --- Markdown Report Tests ---

describe('generateMarkdownReport', () => {
  it('should generate a valid markdown table', () => {
    const reports: BenchmarkReport[] = [
      {
        runner: 'grep',
        timestamp: '2026-01-01T00:00:00.000Z',
        totalQueries: 55,
        aggregateMetrics: {
          precisionAt5: 0.2345,
          precisionAt10: 0.1234,
          recallAt5: 0.3456,
          recallAt10: 0.4567,
          mrr: 0.5678,
          ndcgAt10: 0.6789,
        },
        queryResults: [],
      },
      {
        runner: 'coderag',
        timestamp: '2026-01-01T00:00:00.000Z',
        totalQueries: 55,
        aggregateMetrics: {
          precisionAt5: 0.8,
          precisionAt10: 0.7,
          recallAt5: 0.85,
          recallAt10: 0.9,
          mrr: 0.95,
          ndcgAt10: 0.88,
        },
        queryResults: [],
      },
    ];

    const markdown = generateMarkdownReport(reports);

    expect(markdown).toContain('# Benchmark Results');
    expect(markdown).toContain('| Runner |');
    expect(markdown).toContain('| grep |');
    expect(markdown).toContain('| coderag |');
    expect(markdown).toContain('0.2345');
    expect(markdown).toContain('0.8000');
    expect(markdown).toContain('| 55 |');
  });

  it('should handle empty reports array', () => {
    const markdown = generateMarkdownReport([]);
    expect(markdown).toContain('# Benchmark Results');
    expect(markdown).toContain('| Runner |');
  });

  it('should contain header row', () => {
    const markdown = generateMarkdownReport([]);
    expect(markdown).toContain('P@5');
    expect(markdown).toContain('P@10');
    expect(markdown).toContain('R@5');
    expect(markdown).toContain('R@10');
    expect(markdown).toContain('MRR');
    expect(markdown).toContain('nDCG@10');
  });
});
