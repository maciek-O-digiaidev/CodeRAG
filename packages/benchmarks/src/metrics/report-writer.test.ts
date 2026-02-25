import { describe, it, expect } from 'vitest';
import { writeJsonReport, writeMarkdownReport } from './report-writer.js';
import type { MetricsReport } from './types.js';

function makeReport(overrides?: Partial<MetricsReport>): MetricsReport {
  return {
    perQuery: [
      {
        query: 'Find the HybridSearch class',
        retrievedIds: ['hybrid-search.ts', 'bm25-index.ts'],
        expectedIds: ['hybrid-search.ts'],
        metrics: {
          precisionAt5: 0.2,
          precisionAt10: 0.1,
          recallAt5: 1.0,
          recallAt10: 1.0,
          mrr: 1.0,
          ndcgAt10: 1.0,
          map: 1.0,
          contextPrecision: 1.0,
          contextRecall: null,
        },
      },
    ],
    aggregate: {
      precisionAt5: 0.2,
      precisionAt10: 0.1,
      recallAt5: 1.0,
      recallAt10: 1.0,
      mrr: 1.0,
      ndcgAt10: 1.0,
      map: 1.0,
      contextPrecision: 1.0,
      contextRecall: null,
    },
    metadata: {
      datasetName: 'test-dataset',
      timestamp: '2026-02-25T12:00:00.000Z',
      queryCount: 1,
    },
    ...overrides,
  };
}

// --- writeJsonReport ---

describe('writeJsonReport', () => {
  it('should produce valid JSON string', () => {
    const report = makeReport();
    const json = writeJsonReport(report);

    const parsed = JSON.parse(json) as MetricsReport;
    expect(parsed.metadata.datasetName).toBe('test-dataset');
    expect(parsed.perQuery).toHaveLength(1);
    expect(parsed.aggregate.mrr).toBe(1.0);
  });

  it('should include all metric fields', () => {
    const json = writeJsonReport(makeReport());
    const parsed = JSON.parse(json) as MetricsReport;
    const agg = parsed.aggregate;

    expect(agg).toHaveProperty('precisionAt5');
    expect(agg).toHaveProperty('precisionAt10');
    expect(agg).toHaveProperty('recallAt5');
    expect(agg).toHaveProperty('recallAt10');
    expect(agg).toHaveProperty('mrr');
    expect(agg).toHaveProperty('ndcgAt10');
    expect(agg).toHaveProperty('map');
    expect(agg).toHaveProperty('contextPrecision');
    expect(agg).toHaveProperty('contextRecall');
  });

  it('should handle report with context_recall values', () => {
    const report = makeReport({
      aggregate: {
        precisionAt5: 0.5,
        precisionAt10: 0.3,
        recallAt5: 0.8,
        recallAt10: 0.9,
        mrr: 0.75,
        ndcgAt10: 0.8,
        map: 0.7,
        contextPrecision: 0.85,
        contextRecall: 0.9,
      },
    });
    const json = writeJsonReport(report);
    const parsed = JSON.parse(json) as MetricsReport;
    expect(parsed.aggregate.contextRecall).toBe(0.9);
  });

  it('should preserve null context_recall in JSON', () => {
    const json = writeJsonReport(makeReport());
    const parsed = JSON.parse(json) as MetricsReport;
    expect(parsed.aggregate.contextRecall).toBeNull();
  });

  it('should be formatted with indentation', () => {
    const json = writeJsonReport(makeReport());
    // Formatted JSON should contain newlines
    expect(json).toContain('\n');
    // Should contain indentation
    expect(json).toContain('  ');
  });

  it('should handle empty perQuery results', () => {
    const report = makeReport({
      perQuery: [],
      metadata: { datasetName: 'empty', timestamp: '2026-01-01T00:00:00.000Z', queryCount: 0 },
    });
    const json = writeJsonReport(report);
    const parsed = JSON.parse(json) as MetricsReport;
    expect(parsed.perQuery).toHaveLength(0);
  });
});

// --- writeMarkdownReport ---

describe('writeMarkdownReport', () => {
  it('should produce a markdown report with header', () => {
    const md = writeMarkdownReport(makeReport());
    expect(md).toContain('# IR Metrics Report');
  });

  it('should include dataset name and date', () => {
    const md = writeMarkdownReport(makeReport());
    expect(md).toContain('**Dataset**: test-dataset');
    expect(md).toContain('**Date**: 2026-02-25');
    expect(md).toContain('**Queries**: 1');
  });

  it('should include aggregate metrics table', () => {
    const md = writeMarkdownReport(makeReport());
    expect(md).toContain('## Aggregate Metrics');
    expect(md).toContain('| Metric | Value |');
    expect(md).toContain('Precision@5');
    expect(md).toContain('Recall@5');
    expect(md).toContain('MRR');
    expect(md).toContain('nDCG@10');
    expect(md).toContain('MAP');
    expect(md).toContain('Context Precision');
    expect(md).toContain('Context Recall');
  });

  it('should show N/A for null context_recall', () => {
    const md = writeMarkdownReport(makeReport());
    expect(md).toContain('N/A');
  });

  it('should show numeric value for non-null context_recall', () => {
    const report = makeReport({
      aggregate: {
        precisionAt5: 0.5,
        precisionAt10: 0.3,
        recallAt5: 0.8,
        recallAt10: 0.9,
        mrr: 0.75,
        ndcgAt10: 0.8,
        map: 0.7,
        contextPrecision: 0.85,
        contextRecall: 0.9,
      },
    });
    const md = writeMarkdownReport(report);
    expect(md).toContain('0.9000');
    expect(md).not.toContain('N/A');
  });

  it('should include per-query results section', () => {
    const md = writeMarkdownReport(makeReport());
    expect(md).toContain('## Per-Query Results');
    expect(md).toContain('Find the HybridSearch class');
  });

  it('should truncate long query strings', () => {
    const longQuery = 'A'.repeat(60);
    const report = makeReport({
      perQuery: [
        {
          query: longQuery,
          retrievedIds: ['a.ts'],
          expectedIds: ['a.ts'],
          metrics: {
            precisionAt5: 0.2,
            precisionAt10: 0.1,
            recallAt5: 1.0,
            recallAt10: 1.0,
            mrr: 1.0,
            ndcgAt10: 1.0,
            map: 1.0,
            contextPrecision: 1.0,
            contextRecall: null,
          },
        },
      ],
    });
    const md = writeMarkdownReport(report);
    expect(md).toContain('...');
    // Should not contain the full 60-char query
    expect(md).not.toContain(longQuery);
  });

  it('should handle empty perQuery without per-query section', () => {
    const report = makeReport({ perQuery: [] });
    const md = writeMarkdownReport(report);
    expect(md).not.toContain('## Per-Query Results');
  });

  it('should format numbers to 4 decimal places', () => {
    const md = writeMarkdownReport(makeReport());
    expect(md).toContain('0.2000');
    expect(md).toContain('1.0000');
  });
});
