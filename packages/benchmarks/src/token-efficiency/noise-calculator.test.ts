import { describe, it, expect } from 'vitest';
import {
  estimateTokenCount,
  computeNoiseRatio,
  computeTokenBreakdown,
} from './noise-calculator.js';
import type { ChunkTokenInfo } from './noise-calculator.js';

describe('estimateTokenCount', () => {
  it('should approximate tokens as text length / 4', () => {
    // 20 characters -> ceil(20/4) = 5
    expect(estimateTokenCount('12345678901234567890')).toBe(5);
  });

  it('should return 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('should ceil fractional tokens', () => {
    // 5 characters -> ceil(5/4) = 2
    expect(estimateTokenCount('hello')).toBe(2);
  });

  it('should handle single character', () => {
    // 1 character -> ceil(1/4) = 1
    expect(estimateTokenCount('a')).toBe(1);
  });

  it('should handle exact multiples of 4', () => {
    // 8 characters -> ceil(8/4) = 2
    expect(estimateTokenCount('abcdefgh')).toBe(2);
  });
});

describe('computeNoiseRatio', () => {
  it('should return 0 when all tokens are relevant', () => {
    expect(computeNoiseRatio(100, 100)).toBe(0);
  });

  it('should return 1 when no tokens are relevant', () => {
    expect(computeNoiseRatio(0, 100)).toBe(1);
  });

  it('should return 0 when total tokens is 0', () => {
    expect(computeNoiseRatio(0, 0)).toBe(0);
  });

  it('should return 0.5 when half tokens are relevant', () => {
    expect(computeNoiseRatio(50, 100)).toBe(0.5);
  });

  it('should return correct fraction for partial relevance', () => {
    // 30 relevant out of 100 -> noise = 1 - 0.3 = 0.7
    expect(computeNoiseRatio(30, 100)).toBeCloseTo(0.7);
  });

  it('should return 0 for negative total tokens', () => {
    expect(computeNoiseRatio(0, -10)).toBe(0);
  });

  it('should return 1 for negative relevant tokens', () => {
    expect(computeNoiseRatio(-5, 100)).toBe(1);
  });

  it('should clamp to 0 when relevant exceeds total', () => {
    // This edge case: ratio = 1 - 150/100 = -0.5, clamped to 0
    expect(computeNoiseRatio(150, 100)).toBe(0);
  });
});

describe('computeTokenBreakdown', () => {
  it('should compute breakdown for all relevant chunks', () => {
    const chunks: ChunkTokenInfo[] = [
      { id: 'a', tokenCount: 50 },
      { id: 'b', tokenCount: 30 },
    ];
    const relevant = new Set(['a', 'b']);

    const result = computeTokenBreakdown(chunks, relevant);

    expect(result.totalTokens).toBe(80);
    expect(result.relevantTokens).toBe(80);
    expect(result.noiseRatio).toBe(0);
  });

  it('should compute breakdown when no chunks are relevant', () => {
    const chunks: ChunkTokenInfo[] = [
      { id: 'a', tokenCount: 50 },
      { id: 'b', tokenCount: 30 },
    ];
    const relevant = new Set(['x', 'y']);

    const result = computeTokenBreakdown(chunks, relevant);

    expect(result.totalTokens).toBe(80);
    expect(result.relevantTokens).toBe(0);
    expect(result.noiseRatio).toBe(1);
  });

  it('should compute breakdown for partial relevance', () => {
    const chunks: ChunkTokenInfo[] = [
      { id: 'a', tokenCount: 40 },
      { id: 'b', tokenCount: 30 },
      { id: 'c', tokenCount: 30 },
    ];
    const relevant = new Set(['a']);

    const result = computeTokenBreakdown(chunks, relevant);

    expect(result.totalTokens).toBe(100);
    expect(result.relevantTokens).toBe(40);
    expect(result.noiseRatio).toBeCloseTo(0.6);
  });

  it('should handle empty chunks array', () => {
    const result = computeTokenBreakdown([], new Set(['a']));

    expect(result.totalTokens).toBe(0);
    expect(result.relevantTokens).toBe(0);
    expect(result.noiseRatio).toBe(0);
  });

  it('should handle empty relevant set', () => {
    const chunks: ChunkTokenInfo[] = [{ id: 'a', tokenCount: 50 }];
    const result = computeTokenBreakdown(chunks, new Set());

    expect(result.totalTokens).toBe(50);
    expect(result.relevantTokens).toBe(0);
    expect(result.noiseRatio).toBe(1);
  });
});
