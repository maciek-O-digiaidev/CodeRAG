import { describe, it, expect } from 'vitest';
import {
  precisionAtK,
  recallAtK,
  mrr,
  ndcgAtK,
  averagePrecision,
  contextPrecision,
  contextRecall,
} from './ir-metrics.js';

// --- Precision@K Tests ---

describe('precisionAtK', () => {
  it('should return 1.0 when all top-K are relevant', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set(['a', 'b', 'c']);
    expect(precisionAtK(retrieved, relevant, 3)).toBe(1.0);
  });

  it('should return 0.0 when no top-K are relevant', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(precisionAtK(retrieved, relevant, 3)).toBe(0.0);
  });

  it('should return correct fraction for partial match', () => {
    const retrieved = ['a', 'x', 'b', 'y'];
    const relevant = new Set(['a', 'b']);
    expect(precisionAtK(retrieved, relevant, 4)).toBe(0.5);
  });

  it('should only consider top-K items', () => {
    const retrieved = ['a', 'x', 'b'];
    const relevant = new Set(['a', 'b']);
    // At K=2, only ['a', 'x'] are considered: 1 hit / 2
    expect(precisionAtK(retrieved, relevant, 2)).toBe(0.5);
  });

  it('should return 0 for K <= 0', () => {
    expect(precisionAtK(['a'], new Set(['a']), 0)).toBe(0);
    expect(precisionAtK(['a'], new Set(['a']), -1)).toBe(0);
  });

  it('should return 0 for empty retrieved', () => {
    expect(precisionAtK([], new Set(['a']), 5)).toBe(0);
  });

  it('should penalize when retrieved count is less than K', () => {
    const retrieved = ['a', 'b'];
    const relevant = new Set(['a', 'b']);
    // Standard P@K: 2 hits / K=10 = 0.2
    expect(precisionAtK(retrieved, relevant, 10)).toBe(0.2);
  });

  it('should handle empty relevant set', () => {
    const retrieved = ['a', 'b'];
    const relevant = new Set<string>();
    expect(precisionAtK(retrieved, relevant, 5)).toBe(0);
  });
});

// --- Recall@K Tests ---

describe('recallAtK', () => {
  it('should return 1.0 when all relevant are retrieved', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set(['a', 'b']);
    expect(recallAtK(retrieved, relevant, 3)).toBe(1.0);
  });

  it('should return 0.0 when no relevant are retrieved', () => {
    const retrieved = ['x', 'y'];
    const relevant = new Set(['a', 'b']);
    expect(recallAtK(retrieved, relevant, 2)).toBe(0.0);
  });

  it('should return correct fraction', () => {
    const retrieved = ['a', 'x', 'y'];
    const relevant = new Set(['a', 'b']);
    expect(recallAtK(retrieved, relevant, 3)).toBe(0.5);
  });

  it('should return 0 for empty relevant', () => {
    expect(recallAtK(['a'], new Set<string>(), 5)).toBe(0);
  });

  it('should return 0 for K <= 0', () => {
    expect(recallAtK(['a'], new Set(['a']), 0)).toBe(0);
  });

  it('should handle K larger than retrieved list', () => {
    const retrieved = ['a', 'b'];
    const relevant = new Set(['a', 'b', 'c']);
    // 2 found out of 3 relevant
    expect(recallAtK(retrieved, relevant, 10)).toBeCloseTo(2 / 3);
  });
});

// --- MRR Tests ---

describe('mrr', () => {
  it('should return 1.0 when first result is relevant', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set(['a']);
    expect(mrr(retrieved, relevant)).toBe(1.0);
  });

  it('should return 0.5 when second result is first relevant', () => {
    const retrieved = ['x', 'a', 'b'];
    const relevant = new Set(['a']);
    expect(mrr(retrieved, relevant)).toBe(0.5);
  });

  it('should return 1/3 when third result is first relevant', () => {
    const retrieved = ['x', 'y', 'a'];
    const relevant = new Set(['a']);
    expect(mrr(retrieved, relevant)).toBeCloseTo(1 / 3);
  });

  it('should return 0 when no relevant result found', () => {
    const retrieved = ['x', 'y'];
    const relevant = new Set(['a']);
    expect(mrr(retrieved, relevant)).toBe(0);
  });

  it('should return 0 for empty retrieved', () => {
    expect(mrr([], new Set(['a']))).toBe(0);
  });

  it('should find the first relevant among multiple', () => {
    const retrieved = ['x', 'a', 'b'];
    const relevant = new Set(['a', 'b']);
    // First relevant is at rank 2
    expect(mrr(retrieved, relevant)).toBe(0.5);
  });

  it('should return 0 for empty relevant set', () => {
    const retrieved = ['a', 'b'];
    expect(mrr(retrieved, new Set<string>())).toBe(0);
  });
});

// --- nDCG@K Tests ---

describe('ndcgAtK', () => {
  it('should return 1.0 for perfect ranking', () => {
    const retrieved = ['a', 'b'];
    const relevant = new Set(['a', 'b']);
    expect(ndcgAtK(retrieved, relevant, 2)).toBeCloseTo(1.0);
  });

  it('should return 0 for no relevant results', () => {
    const retrieved = ['x', 'y'];
    const relevant = new Set(['a']);
    expect(ndcgAtK(retrieved, relevant, 2)).toBe(0);
  });

  it('should return less than 1.0 for imperfect ranking', () => {
    // Relevant item at position 2 instead of 1
    const retrieved = ['x', 'a'];
    const relevant = new Set(['a']);
    const result = ndcgAtK(retrieved, relevant, 2);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it('should return 0 for K <= 0', () => {
    expect(ndcgAtK(['a'], new Set(['a']), 0)).toBe(0);
  });

  it('should return 0 for empty relevant', () => {
    expect(ndcgAtK(['a'], new Set<string>(), 5)).toBe(0);
  });

  it('should handle K larger than retrieved', () => {
    const retrieved = ['a'];
    const relevant = new Set(['a']);
    expect(ndcgAtK(retrieved, relevant, 10)).toBeCloseTo(1.0);
  });

  it('should penalize later relevant results', () => {
    const relevant = new Set(['a', 'b']);
    const perfect = ndcgAtK(['a', 'b', 'x'], relevant, 3);
    const swapped = ndcgAtK(['x', 'a', 'b'], relevant, 3);
    expect(perfect).toBeGreaterThan(swapped);
  });

  it('should compute known nDCG value for textbook example', () => {
    // Textbook: 3 relevant, retrieved = [R, N, R, N, R] at K=5
    // DCG = 1/log2(2) + 0 + 1/log2(4) + 0 + 1/log2(6)
    //     = 1/1 + 0 + 1/2 + 0 + 1/log2(6)
    //     = 1 + 0.5 + 0.38685...
    //     = 1.88685...
    // IDCG = 1/log2(2) + 1/log2(3) + 1/log2(4)
    //      = 1 + 0.63093 + 0.5
    //      = 2.13093
    // nDCG = 1.88685/2.13093 = 0.88544...
    const retrieved = ['r1', 'n1', 'r2', 'n2', 'r3'];
    const relevant = new Set(['r1', 'r2', 'r3']);
    const result = ndcgAtK(retrieved, relevant, 5);
    expect(result).toBeCloseTo(0.8855, 3);
  });
});

// --- MAP (Average Precision) Tests ---

describe('averagePrecision', () => {
  it('should return 1.0 for perfect ranking with all relevant at top', () => {
    const retrieved = ['a', 'b', 'x', 'y'];
    const relevant = new Set(['a', 'b']);
    // AP = (1/1 + 2/2) / 2 = (1 + 1) / 2 = 1.0
    expect(averagePrecision(retrieved, relevant)).toBe(1.0);
  });

  it('should return correct AP for known example', () => {
    // Retrieved: [R, N, R, N, R], 3 relevant
    // Precision at relevant positions:
    //   pos 1: R -> P@1 = 1/1 = 1.0
    //   pos 3: R -> P@3 = 2/3 = 0.6667
    //   pos 5: R -> P@5 = 3/5 = 0.6
    // AP = (1.0 + 0.6667 + 0.6) / 3 = 0.7556
    const retrieved = ['r1', 'n1', 'r2', 'n2', 'r3'];
    const relevant = new Set(['r1', 'r2', 'r3']);
    expect(averagePrecision(retrieved, relevant)).toBeCloseTo(0.7556, 3);
  });

  it('should return lower AP when relevant items appear later', () => {
    // All relevant at the end
    const retrieved = ['x', 'y', 'a', 'b'];
    const relevant = new Set(['a', 'b']);
    // AP = (1/3 + 2/4) / 2 = (0.3333 + 0.5) / 2 = 0.4167
    expect(averagePrecision(retrieved, relevant)).toBeCloseTo(0.4167, 3);
  });

  it('should return 0 for no relevant results found', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(averagePrecision(retrieved, relevant)).toBe(0);
  });

  it('should return 0 for empty relevant set', () => {
    expect(averagePrecision(['a', 'b'], new Set<string>())).toBe(0);
  });

  it('should return 0 for empty retrieved list', () => {
    expect(averagePrecision([], new Set(['a']))).toBe(0);
  });

  it('should penalize not finding all relevant items', () => {
    // Only 1 of 3 relevant found at position 1
    // AP = (1/1) / 3 = 0.3333
    const retrieved = ['a', 'x'];
    const relevant = new Set(['a', 'b', 'c']);
    expect(averagePrecision(retrieved, relevant)).toBeCloseTo(1 / 3, 4);
  });

  it('should handle single relevant item at position 1', () => {
    const retrieved = ['a', 'x', 'y'];
    const relevant = new Set(['a']);
    // AP = (1/1) / 1 = 1.0
    expect(averagePrecision(retrieved, relevant)).toBe(1.0);
  });
});

// --- Context Precision Tests ---

describe('contextPrecision', () => {
  it('should return 1.0 when all relevant are before irrelevant', () => {
    const retrieved = ['r1', 'r2', 'n1', 'n2'];
    const relevant = new Set(['r1', 'r2']);
    // pos 1: R -> P@1 = 1/1 = 1.0
    // pos 2: R -> P@2 = 2/2 = 1.0
    // contextPrecision = (1.0 + 1.0) / 2 = 1.0
    expect(contextPrecision(retrieved, relevant)).toBe(1.0);
  });

  it('should return < 1.0 when irrelevant items precede relevant', () => {
    const retrieved = ['n1', 'r1', 'n2', 'r2'];
    const relevant = new Set(['r1', 'r2']);
    // pos 2: R -> P@2 = 1/2 = 0.5
    // pos 4: R -> P@4 = 2/4 = 0.5
    // contextPrecision = (0.5 + 0.5) / 2 = 0.5
    expect(contextPrecision(retrieved, relevant)).toBe(0.5);
  });

  it('should return 0 when no relevant items found', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(contextPrecision(retrieved, relevant)).toBe(0);
  });

  it('should return 0 for empty relevant set', () => {
    expect(contextPrecision(['a'], new Set<string>())).toBe(0);
  });

  it('should return 0 for empty retrieved list', () => {
    expect(contextPrecision([], new Set(['a']))).toBe(0);
  });

  it('should distinguish between good and bad orderings', () => {
    const relevant = new Set(['r1', 'r2']);
    const good = contextPrecision(['r1', 'r2', 'n1', 'n2'], relevant);
    const bad = contextPrecision(['n1', 'n2', 'r1', 'r2'], relevant);
    expect(good).toBeGreaterThan(bad);
  });

  it('should compute known value for mixed ordering', () => {
    // Retrieved: [R, N, R], 2 relevant
    // pos 1: R -> P@1 = 1/1 = 1.0
    // pos 3: R -> P@3 = 2/3 = 0.6667
    // contextPrecision = (1.0 + 0.6667) / 2 = 0.8333
    const retrieved = ['r1', 'n1', 'r2'];
    const relevant = new Set(['r1', 'r2']);
    expect(contextPrecision(retrieved, relevant)).toBeCloseTo(0.8333, 3);
  });
});

// --- Context Recall Tests ---

describe('contextRecall', () => {
  it('should return 1.0 when all expected info is found in context', () => {
    const expectedInfo = ['function foo', 'class Bar'];
    const context = 'This module defines function foo and class Bar with methods.';
    expect(contextRecall(expectedInfo, context)).toBe(1.0);
  });

  it('should return 0.5 when half of expected info is found', () => {
    const expectedInfo = ['function foo', 'class Bar'];
    const context = 'This module defines function foo.';
    expect(contextRecall(expectedInfo, context)).toBe(0.5);
  });

  it('should return 0 when no expected info is found', () => {
    const expectedInfo = ['function foo', 'class Bar'];
    const context = 'Completely unrelated text.';
    expect(contextRecall(expectedInfo, context)).toBe(0);
  });

  it('should return null when expectedInfo is empty', () => {
    expect(contextRecall([], 'some context')).toBeNull();
  });

  it('should return 0 when context is empty but expectedInfo is not', () => {
    expect(contextRecall(['foo'], '')).toBe(0);
  });

  it('should be case-insensitive', () => {
    const expectedInfo = ['FUNCTION FOO'];
    const context = 'this defines function foo here';
    expect(contextRecall(expectedInfo, context)).toBe(1.0);
  });

  it('should handle partial matches correctly', () => {
    const expectedInfo = ['foobar', 'foo'];
    const context = 'The function foo is defined here.';
    // "foo" is found, but "foobar" is not
    expect(contextRecall(expectedInfo, context)).toBe(0.5);
  });
});
