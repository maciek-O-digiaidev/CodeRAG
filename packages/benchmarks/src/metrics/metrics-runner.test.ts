import { describe, it, expect } from 'vitest';
import {
  computeSingleQueryMetrics,
  computeAggregateMetrics,
  runMetrics,
  adaptLegacyDataset,
} from './metrics-runner.js';
import type {
  GenericBenchmarkDataset,
  QueryMetricsResult,
} from './types.js';
import type { BenchmarkDataset as LegacyDataset } from '../types.js';

// --- computeSingleQueryMetrics ---

describe('computeSingleQueryMetrics', () => {
  it('should compute all standard metrics for a perfect retrieval', () => {
    const retrieved = ['a', 'b', 'c'];
    const expected = ['a', 'b', 'c'];
    const metrics = computeSingleQueryMetrics(retrieved, expected);

    expect(metrics.precisionAt5).toBeGreaterThan(0);
    expect(metrics.recallAt5).toBe(1.0);
    expect(metrics.mrr).toBe(1.0);
    expect(metrics.ndcgAt10).toBeCloseTo(1.0);
    expect(metrics.map).toBe(1.0);
    expect(metrics.contextPrecision).toBe(1.0);
    expect(metrics.contextRecall).toBeNull();
  });

  it('should compute all metrics for no relevant results', () => {
    const retrieved = ['x', 'y', 'z'];
    const expected = ['a', 'b'];
    const metrics = computeSingleQueryMetrics(retrieved, expected);

    expect(metrics.precisionAt5).toBe(0);
    expect(metrics.recallAt5).toBe(0);
    expect(metrics.mrr).toBe(0);
    expect(metrics.ndcgAt10).toBe(0);
    expect(metrics.map).toBe(0);
    expect(metrics.contextPrecision).toBe(0);
    expect(metrics.contextRecall).toBeNull();
  });

  it('should compute context_recall when context is provided', () => {
    const retrieved = ['a', 'b'];
    const expected = ['function foo', 'class Bar'];
    const context = 'This module defines function foo and class Bar.';
    const metrics = computeSingleQueryMetrics(retrieved, expected, context);

    // context_recall checks if expected IDs (used as info strings) are found in context
    expect(metrics.contextRecall).toBe(1.0);
  });

  it('should return null context_recall when no context provided', () => {
    const metrics = computeSingleQueryMetrics(['a'], ['a']);
    expect(metrics.contextRecall).toBeNull();
  });

  it('should handle empty retrieved list', () => {
    const metrics = computeSingleQueryMetrics([], ['a', 'b']);
    expect(metrics.precisionAt5).toBe(0);
    expect(metrics.recallAt5).toBe(0);
    expect(metrics.mrr).toBe(0);
    expect(metrics.map).toBe(0);
  });

  it('should handle empty expected list', () => {
    const metrics = computeSingleQueryMetrics(['a', 'b'], []);
    expect(metrics.precisionAt5).toBe(0);
    expect(metrics.recallAt5).toBe(0);
    expect(metrics.mrr).toBe(0);
    expect(metrics.ndcgAt10).toBe(0);
    expect(metrics.map).toBe(0);
    expect(metrics.contextPrecision).toBe(0);
  });
});

// --- computeAggregateMetrics ---

describe('computeAggregateMetrics', () => {
  it('should return zeros for empty results', () => {
    const agg = computeAggregateMetrics([]);
    expect(agg.precisionAt5).toBe(0);
    expect(agg.recallAt5).toBe(0);
    expect(agg.mrr).toBe(0);
    expect(agg.ndcgAt10).toBe(0);
    expect(agg.map).toBe(0);
    expect(agg.contextPrecision).toBe(0);
    expect(agg.contextRecall).toBeNull();
  });

  it('should average metrics across two queries', () => {
    const results: QueryMetricsResult[] = [
      {
        query: 'q1',
        retrievedIds: ['a'],
        expectedIds: ['a'],
        metrics: {
          precisionAt5: 1.0,
          precisionAt10: 1.0,
          recallAt5: 1.0,
          recallAt10: 1.0,
          mrr: 1.0,
          ndcgAt10: 1.0,
          map: 1.0,
          contextPrecision: 1.0,
          contextRecall: null,
        },
      },
      {
        query: 'q2',
        retrievedIds: ['x'],
        expectedIds: ['a'],
        metrics: {
          precisionAt5: 0.0,
          precisionAt10: 0.0,
          recallAt5: 0.0,
          recallAt10: 0.0,
          mrr: 0.0,
          ndcgAt10: 0.0,
          map: 0.0,
          contextPrecision: 0.0,
          contextRecall: null,
        },
      },
    ];

    const agg = computeAggregateMetrics(results);
    expect(agg.precisionAt5).toBe(0.5);
    expect(agg.mrr).toBe(0.5);
    expect(agg.map).toBe(0.5);
    expect(agg.contextRecall).toBeNull();
  });

  it('should average context_recall only over non-null values', () => {
    const results: QueryMetricsResult[] = [
      {
        query: 'q1',
        retrievedIds: [],
        expectedIds: [],
        metrics: {
          precisionAt5: 0,
          precisionAt10: 0,
          recallAt5: 0,
          recallAt10: 0,
          mrr: 0,
          ndcgAt10: 0,
          map: 0,
          contextPrecision: 0,
          contextRecall: 0.8,
        },
      },
      {
        query: 'q2',
        retrievedIds: [],
        expectedIds: [],
        metrics: {
          precisionAt5: 0,
          precisionAt10: 0,
          recallAt5: 0,
          recallAt10: 0,
          mrr: 0,
          ndcgAt10: 0,
          map: 0,
          contextPrecision: 0,
          contextRecall: null,
        },
      },
      {
        query: 'q3',
        retrievedIds: [],
        expectedIds: [],
        metrics: {
          precisionAt5: 0,
          precisionAt10: 0,
          recallAt5: 0,
          recallAt10: 0,
          mrr: 0,
          ndcgAt10: 0,
          map: 0,
          contextPrecision: 0,
          contextRecall: 0.6,
        },
      },
    ];

    const agg = computeAggregateMetrics(results);
    // Only q1 and q3 have context_recall; average = (0.8 + 0.6) / 2 = 0.7
    expect(agg.contextRecall).toBeCloseTo(0.7);
  });
});

// --- runMetrics ---

describe('runMetrics', () => {
  it('should run metrics across a dataset and produce a report', async () => {
    const dataset: GenericBenchmarkDataset = {
      queries: [
        { query: 'find foo', expectedChunkIds: ['foo.ts', 'bar.ts'] },
        { query: 'find baz', expectedChunkIds: ['baz.ts'] },
      ],
    };

    // Simple mock retrieval: always returns a fixed list
    const retrievalFn = async (_query: string) => ['foo.ts', 'qux.ts', 'baz.ts'];

    const report = await runMetrics(dataset, retrievalFn, 'test-dataset');

    expect(report.metadata.datasetName).toBe('test-dataset');
    expect(report.metadata.queryCount).toBe(2);
    expect(report.perQuery).toHaveLength(2);
    expect(report.aggregate.precisionAt5).toBeGreaterThan(0);
    expect(report.aggregate.mrr).toBeGreaterThan(0);
  });

  it('should handle empty dataset', async () => {
    const dataset: GenericBenchmarkDataset = { queries: [] };
    const retrievalFn = async (_query: string) => [] as string[];

    const report = await runMetrics(dataset, retrievalFn);

    expect(report.perQuery).toHaveLength(0);
    expect(report.aggregate.precisionAt5).toBe(0);
    expect(report.metadata.datasetName).toBe('unnamed');
  });

  it('should compute context_recall when query provides context', async () => {
    const dataset: GenericBenchmarkDataset = {
      queries: [
        {
          query: 'find the parser',
          expectedChunkIds: ['parser.ts'],
          context: 'The parser.ts module handles parsing of source code.',
        },
      ],
    };

    const retrievalFn = async (_query: string) => ['parser.ts'];
    const report = await runMetrics(dataset, retrievalFn, 'ctx-test');

    const firstQuery = report.perQuery[0];
    expect(firstQuery).toBeDefined();
    expect(firstQuery!.metrics.contextRecall).toBe(1.0);
    expect(report.aggregate.contextRecall).toBe(1.0);
  });

  it('should handle queries with no context gracefully', async () => {
    const dataset: GenericBenchmarkDataset = {
      queries: [
        { query: 'find foo', expectedChunkIds: ['foo.ts'] },
      ],
    };

    const retrievalFn = async (_query: string) => ['foo.ts'];
    const report = await runMetrics(dataset, retrievalFn);

    expect(report.perQuery[0]!.metrics.contextRecall).toBeNull();
    expect(report.aggregate.contextRecall).toBeNull();
  });

  it('should work with synthetic Tier 1 datasets', async () => {
    // Simulates a synthetic dataset with generated queries
    const syntheticDataset: GenericBenchmarkDataset = {
      queries: [
        { query: 'What does function handleRequest do?', expectedChunkIds: ['server.ts::handleRequest'] },
        { query: 'How is auth middleware configured?', expectedChunkIds: ['auth.ts::middleware', 'config.ts::authConfig'] },
      ],
      metadata: { generator: 'synthetic-tier1', version: '1.0' },
    };

    const retrievalFn = async (query: string) => {
      if (query.includes('handleRequest')) {
        return ['server.ts::handleRequest', 'utils.ts::logRequest'];
      }
      return ['auth.ts::middleware', 'routes.ts::setup'];
    };

    const report = await runMetrics(syntheticDataset, retrievalFn, 'synthetic');

    expect(report.metadata.datasetName).toBe('synthetic');
    expect(report.metadata.queryCount).toBe(2);
    // First query: perfect match at position 1
    expect(report.perQuery[0]!.metrics.mrr).toBe(1.0);
    // Second query: 1 of 2 relevant found
    expect(report.perQuery[1]!.metrics.recallAt5).toBe(0.5);
  });

  it('should work with adapted external Tier 2 datasets', async () => {
    // Simulates an external dataset adapted to the generic format
    const externalDataset: GenericBenchmarkDataset = {
      queries: [
        { query: 'binary search implementation', expectedChunkIds: ['search.py::binary_search'] },
        { query: 'sorting algorithm', expectedChunkIds: ['sort.py::quicksort', 'sort.py::mergesort'] },
      ],
      metadata: { source: 'external-benchmark-suite', adaptedBy: 'tier2-adapter' },
    };

    const retrievalFn = async (_query: string) => [
      'search.py::binary_search',
      'sort.py::quicksort',
      'utils.py::helper',
    ];

    const report = await runMetrics(externalDataset, retrievalFn, 'external');
    expect(report.metadata.queryCount).toBe(2);
    expect(report.aggregate.mrr).toBeGreaterThan(0);
  });
});

// --- adaptLegacyDataset ---

describe('adaptLegacyDataset', () => {
  it('should adapt a legacy BenchmarkDataset to GenericBenchmarkDataset', () => {
    const legacy: LegacyDataset = {
      name: 'coderag-self-benchmark',
      description: 'Curated benchmark dataset',
      targetRepo: 'https://github.com/coderag/coderag',
      queries: [
        {
          id: 'easy-001',
          query: 'Find the HybridSearch class',
          difficulty: 'easy',
          category: 'function_lookup',
          expectedChunks: [
            {
              filePath: 'packages/core/src/embedding/hybrid-search.ts',
              chunkType: 'class',
              name: 'HybridSearch',
              relevance: 'primary',
            },
          ],
          tags: ['class', 'embedding', 'search'],
        },
        {
          id: 'medium-001',
          query: 'How does embedding generation work',
          difficulty: 'medium',
          category: 'concept_search',
          expectedChunks: [
            {
              filePath: 'packages/core/src/embedding/ollama-embedding-provider.ts',
              chunkType: 'class',
              name: 'OllamaEmbeddingProvider',
              relevance: 'primary',
            },
            {
              filePath: 'packages/core/src/embedding/hybrid-search.ts',
              chunkType: 'class',
              name: 'HybridSearch',
              relevance: 'secondary',
            },
          ],
          tags: ['embedding'],
        },
      ],
    };

    const adapted = adaptLegacyDataset(legacy);

    expect(adapted.queries).toHaveLength(2);
    expect(adapted.queries[0]!.query).toBe('Find the HybridSearch class');
    expect(adapted.queries[0]!.expectedChunkIds).toEqual([
      'packages/core/src/embedding/hybrid-search.ts',
    ]);
    expect(adapted.queries[1]!.expectedChunkIds).toEqual([
      'packages/core/src/embedding/ollama-embedding-provider.ts',
      'packages/core/src/embedding/hybrid-search.ts',
    ]);

    expect(adapted.metadata).toBeDefined();
    expect((adapted.metadata as Record<string, unknown>)['adaptedFromLegacy']).toBe(true);
    expect((adapted.metadata as Record<string, unknown>)['name']).toBe('coderag-self-benchmark');
  });

  it('should handle empty legacy dataset', () => {
    const legacy: LegacyDataset = {
      name: 'empty',
      description: 'Empty dataset',
      targetRepo: '',
      queries: [],
    };

    const adapted = adaptLegacyDataset(legacy);
    expect(adapted.queries).toHaveLength(0);
  });
});
