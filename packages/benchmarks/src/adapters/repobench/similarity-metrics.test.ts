import { describe, it, expect } from 'vitest';
import {
  editDistance,
  editSimilarity,
  exactMatch,
  normalizeWhitespace,
  exactMatchRate,
  averageEditSimilarity,
} from './similarity-metrics.js';

describe('editDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(editDistance('hello', 'hello')).toBe(0);
  });

  it('should return length of non-empty string when other is empty', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });

  it('should return 0 for two empty strings', () => {
    expect(editDistance('', '')).toBe(0);
  });

  it('should compute single substitution', () => {
    expect(editDistance('cat', 'bat')).toBe(1);
  });

  it('should compute single insertion', () => {
    expect(editDistance('cat', 'cats')).toBe(1);
  });

  it('should compute single deletion', () => {
    expect(editDistance('cats', 'cat')).toBe(1);
  });

  it('should compute distance for completely different strings', () => {
    expect(editDistance('abc', 'xyz')).toBe(3);
  });

  it('should handle longer strings correctly', () => {
    // "kitten" -> "sitting": 3 edits
    // k->s, e->i, +g
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('should be symmetric', () => {
    expect(editDistance('abc', 'xyz')).toBe(editDistance('xyz', 'abc'));
    expect(editDistance('kitten', 'sitting')).toBe(editDistance('sitting', 'kitten'));
  });

  it('should handle single-character strings', () => {
    expect(editDistance('a', 'b')).toBe(1);
    expect(editDistance('a', 'a')).toBe(0);
  });
});

describe('editSimilarity', () => {
  it('should return 1.0 for identical strings', () => {
    expect(editSimilarity('hello', 'hello')).toBe(1.0);
  });

  it('should return 1.0 for two empty strings', () => {
    expect(editSimilarity('', '')).toBe(1.0);
  });

  it('should return 0.0 for completely different strings of same length', () => {
    // editDistance("abc", "xyz") = 3, maxLen = 3
    // similarity = 1 - 3/3 = 0
    expect(editSimilarity('abc', 'xyz')).toBe(0.0);
  });

  it('should return intermediate value for partial similarity', () => {
    // editDistance("cat", "bat") = 1, maxLen = 3
    // similarity = 1 - 1/3 = 0.6667
    expect(editSimilarity('cat', 'bat')).toBeCloseTo(0.6667, 3);
  });

  it('should handle different length strings', () => {
    // editDistance("abc", "ab") = 1, maxLen = 3
    // similarity = 1 - 1/3 = 0.6667
    expect(editSimilarity('abc', 'ab')).toBeCloseTo(0.6667, 3);
  });

  it('should handle one empty string', () => {
    // editDistance("abc", "") = 3, maxLen = 3
    // similarity = 1 - 3/3 = 0
    expect(editSimilarity('abc', '')).toBe(0.0);
    expect(editSimilarity('', 'abc')).toBe(0.0);
  });

  it('should be between 0 and 1 inclusive', () => {
    const sim = editSimilarity('function foo() {}', 'function bar() {}');
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

describe('normalizeWhitespace', () => {
  it('should trim leading and trailing whitespace', () => {
    expect(normalizeWhitespace('  hello  ')).toBe('hello');
  });

  it('should collapse internal whitespace', () => {
    expect(normalizeWhitespace('hello   world')).toBe('hello world');
  });

  it('should handle tabs and newlines', () => {
    expect(normalizeWhitespace('hello\t\nworld')).toBe('hello world');
  });

  it('should handle empty string', () => {
    expect(normalizeWhitespace('')).toBe('');
  });

  it('should handle only whitespace', () => {
    expect(normalizeWhitespace('   \t\n  ')).toBe('');
  });
});

describe('exactMatch', () => {
  it('should return true for identical strings', () => {
    expect(exactMatch('hello', 'hello')).toBe(true);
  });

  it('should return true for strings differing only in whitespace', () => {
    expect(exactMatch('  hello  world  ', 'hello world')).toBe(true);
  });

  it('should return false for different strings', () => {
    expect(exactMatch('hello', 'world')).toBe(false);
  });

  it('should handle empty strings', () => {
    expect(exactMatch('', '')).toBe(true);
    expect(exactMatch('', 'hello')).toBe(false);
  });

  it('should normalize multiline code', () => {
    const code1 = 'def foo():\n    return 42';
    const code2 = 'def foo(): return 42';
    expect(exactMatch(code1, code2)).toBe(true);
  });
});

describe('exactMatchRate', () => {
  it('should return 0 for empty input', () => {
    expect(exactMatchRate([])).toBe(0);
  });

  it('should return 1 when all match', () => {
    const pairs: [string, string][] = [
      ['hello', 'hello'],
      ['world', '  world  '],
    ];
    expect(exactMatchRate(pairs)).toBe(1);
  });

  it('should return 0 when none match', () => {
    const pairs: [string, string][] = [
      ['hello', 'world'],
      ['foo', 'bar'],
    ];
    expect(exactMatchRate(pairs)).toBe(0);
  });

  it('should return fraction for partial matches', () => {
    const pairs: [string, string][] = [
      ['hello', 'hello'],
      ['foo', 'bar'],
      ['baz', 'baz'],
    ];
    // 2 out of 3 match
    expect(exactMatchRate(pairs)).toBeCloseTo(2 / 3, 4);
  });
});

describe('averageEditSimilarity', () => {
  it('should return 0 for empty input', () => {
    expect(averageEditSimilarity([])).toBe(0);
  });

  it('should return 1 when all pairs are identical', () => {
    const pairs: [string, string][] = [
      ['hello', 'hello'],
      ['world', 'world'],
    ];
    expect(averageEditSimilarity(pairs)).toBe(1);
  });

  it('should return 0 when all pairs are completely different', () => {
    const pairs: [string, string][] = [
      ['abc', 'xyz'],
      ['def', 'uvw'],
    ];
    expect(averageEditSimilarity(pairs)).toBe(0);
  });

  it('should compute average correctly for mixed pairs', () => {
    const pairs: [string, string][] = [
      ['hello', 'hello'], // similarity = 1.0
      ['abc', 'xyz'],     // similarity = 0.0
    ];
    expect(averageEditSimilarity(pairs)).toBeCloseTo(0.5, 4);
  });
});
