import { describe, it, expect } from 'vitest';
import {
  REPOBENCH_BASELINES,
  getBaselinesForLanguage,
  generateComparisonTable,
} from './baselines.js';

describe('REPOBENCH_BASELINES', () => {
  it('should contain baselines for both Python and Java', () => {
    const pythonBaselines = REPOBENCH_BASELINES.filter((b) => b.language === 'python');
    const javaBaselines = REPOBENCH_BASELINES.filter((b) => b.language === 'java');

    expect(pythonBaselines.length).toBeGreaterThan(0);
    expect(javaBaselines.length).toBeGreaterThan(0);
  });

  it('should include BM25 baseline for both languages', () => {
    const bm25Python = REPOBENCH_BASELINES.find(
      (b) => b.name === 'BM25' && b.language === 'python',
    );
    const bm25Java = REPOBENCH_BASELINES.find(
      (b) => b.name === 'BM25' && b.language === 'java',
    );

    expect(bm25Python).toBeDefined();
    expect(bm25Java).toBeDefined();
  });

  it('should have metrics in valid range [0, 1]', () => {
    for (const baseline of REPOBENCH_BASELINES) {
      expect(baseline.exactMatch).toBeGreaterThanOrEqual(0);
      expect(baseline.exactMatch).toBeLessThanOrEqual(1);
      expect(baseline.editSimilarity).toBeGreaterThanOrEqual(0);
      expect(baseline.editSimilarity).toBeLessThanOrEqual(1);
    }
  });

  it('should include source information', () => {
    for (const baseline of REPOBENCH_BASELINES) {
      expect(baseline.source).toBeTruthy();
    }
  });
});

describe('getBaselinesForLanguage', () => {
  it('should return only Python baselines', () => {
    const baselines = getBaselinesForLanguage('python');
    expect(baselines.length).toBeGreaterThan(0);
    for (const b of baselines) {
      expect(b.language).toBe('python');
    }
  });

  it('should return only Java baselines', () => {
    const baselines = getBaselinesForLanguage('java');
    expect(baselines.length).toBeGreaterThan(0);
    for (const b of baselines) {
      expect(b.language).toBe('java');
    }
  });
});

describe('generateComparisonTable', () => {
  it('should generate a markdown table with CodeRAG result', () => {
    const table = generateComparisonTable(0.10, 0.45, 'python');

    expect(table).toContain('## RepoBench Comparison');
    expect(table).toContain('Python');
    expect(table).toContain('**CodeRAG**');
    expect(table).toContain('10.0%');
    expect(table).toContain('45.0%');
  });

  it('should include baselines sorted by edit similarity', () => {
    const table = generateComparisonTable(0.10, 0.45, 'python');
    const lines = table.split('\n');

    // Find baseline rows (after header and CodeRAG row)
    const dataRows = lines.filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('System'));
    expect(dataRows.length).toBeGreaterThan(1);

    // CodeRAG should be first data row
    expect(dataRows[0]).toContain('**CodeRAG**');
  });

  it('should generate table for Java', () => {
    const table = generateComparisonTable(0.05, 0.35, 'java');

    expect(table).toContain('Java');
    expect(table).toContain('**CodeRAG**');
    expect(table).toContain('5.0%');
    expect(table).toContain('35.0%');
  });

  it('should include all baseline systems', () => {
    const table = generateComparisonTable(0.10, 0.45, 'python');

    expect(table).toContain('BM25');
    expect(table).toContain('UniXcoder');
    expect(table).toContain('CodeBERT');
    expect(table).toContain('Jaccard Similarity');
    expect(table).toContain('Random Retrieval');
  });

  it('should format metrics as percentages', () => {
    const table = generateComparisonTable(0.123, 0.456, 'python');

    expect(table).toContain('12.3%');
    expect(table).toContain('45.6%');
  });
});
