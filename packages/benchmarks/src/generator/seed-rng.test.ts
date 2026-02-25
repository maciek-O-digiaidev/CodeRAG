import { describe, it, expect } from 'vitest';
import { SeededRng } from './seed-rng.js';

describe('SeededRng', () => {
  describe('determinism', () => {
    it('should produce the same sequence for the same seed', () => {
      const rng1 = new SeededRng(42);
      const rng2 = new SeededRng(42);

      const seq1 = Array.from({ length: 100 }, () => rng1.next());
      const seq2 = Array.from({ length: 100 }, () => rng2.next());

      expect(seq1).toEqual(seq2);
    });

    it('should produce different sequences for different seeds', () => {
      const rng1 = new SeededRng(42);
      const rng2 = new SeededRng(43);

      const seq1 = Array.from({ length: 10 }, () => rng1.next());
      const seq2 = Array.from({ length: 10 }, () => rng2.next());

      expect(seq1).not.toEqual(seq2);
    });

    it('should handle seed 0 without degeneration', () => {
      const rng = new SeededRng(0);
      const values = Array.from({ length: 10 }, () => rng.next());
      // All values should be in [0, 1) and not all the same
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      const unique = new Set(values);
      expect(unique.size).toBeGreaterThan(1);
    });

    it('should handle negative seeds', () => {
      const rng = new SeededRng(-100);
      const values = Array.from({ length: 10 }, () => rng.next());
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('should handle very large seeds', () => {
      const rng = new SeededRng(Number.MAX_SAFE_INTEGER);
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
  });

  describe('next', () => {
    it('should return values in [0, 1)', () => {
      const rng = new SeededRng(12345);
      for (let i = 0; i < 1000; i++) {
        const v = rng.next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('should have reasonable distribution', () => {
      const rng = new SeededRng(99);
      let below50 = 0;
      const count = 1000;
      for (let i = 0; i < count; i++) {
        if (rng.next() < 0.5) below50++;
      }
      // Should be roughly 50% (allow wide margin for small sample)
      expect(below50).toBeGreaterThan(count * 0.3);
      expect(below50).toBeLessThan(count * 0.7);
    });
  });

  describe('nextInt', () => {
    it('should return integers in [min, max] inclusive', () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 200; i++) {
        const v = rng.nextInt(5, 10);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThanOrEqual(10);
        expect(Number.isInteger(v)).toBe(true);
      }
    });

    it('should return min when min equals max', () => {
      const rng = new SeededRng(42);
      expect(rng.nextInt(7, 7)).toBe(7);
    });

    it('should cover the full range', () => {
      const rng = new SeededRng(42);
      const seen = new Set<number>();
      for (let i = 0; i < 500; i++) {
        seen.add(rng.nextInt(0, 4));
      }
      // With 500 tries and range 0..4, we should see all values
      expect(seen.size).toBe(5);
    });
  });

  describe('nextBool', () => {
    it('should return boolean values', () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        const v = rng.nextBool();
        expect(typeof v).toBe('boolean');
      }
    });

    it('should respect probability', () => {
      const rng = new SeededRng(42);
      let trueCount = 0;
      const total = 1000;
      for (let i = 0; i < total; i++) {
        if (rng.nextBool(0.8)) trueCount++;
      }
      // Should be roughly 80% true (allow margin)
      expect(trueCount).toBeGreaterThan(total * 0.6);
      expect(trueCount).toBeLessThan(total * 0.95);
    });

    it('should return false with probability 0', () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(0)).toBe(false);
      }
    });

    it('should return true with probability 1', () => {
      const rng = new SeededRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextBool(1)).toBe(true);
      }
    });
  });

  describe('pick', () => {
    it('should return an element from the array', () => {
      const rng = new SeededRng(42);
      const items = ['a', 'b', 'c', 'd'] as const;
      for (let i = 0; i < 100; i++) {
        const picked = rng.pick(items);
        expect(items).toContain(picked);
      }
    });

    it('should be deterministic', () => {
      const items = ['x', 'y', 'z'] as const;
      const rng1 = new SeededRng(42);
      const rng2 = new SeededRng(42);
      const seq1 = Array.from({ length: 20 }, () => rng1.pick(items));
      const seq2 = Array.from({ length: 20 }, () => rng2.pick(items));
      expect(seq1).toEqual(seq2);
    });

    it('should return the only element for single-item array', () => {
      const rng = new SeededRng(42);
      expect(rng.pick(['only'])).toBe('only');
    });
  });

  describe('shuffle', () => {
    it('should return the same elements', () => {
      const rng = new SeededRng(42);
      const items = [1, 2, 3, 4, 5];
      const shuffled = rng.shuffle([...items]);
      expect(shuffled.sort((a, b) => a - b)).toEqual(items);
    });

    it('should be deterministic', () => {
      const rng1 = new SeededRng(42);
      const rng2 = new SeededRng(42);
      const a = rng1.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const b = rng2.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(a).toEqual(b);
    });

    it('should actually change order (with high probability)', () => {
      const rng = new SeededRng(42);
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = rng.shuffle([...original]);
      // Extremely unlikely that a 10-element shuffle produces identity
      expect(shuffled).not.toEqual(original);
    });

    it('should handle empty array', () => {
      const rng = new SeededRng(42);
      expect(rng.shuffle([])).toEqual([]);
    });
  });

  describe('sample', () => {
    it('should return the requested number of elements', () => {
      const rng = new SeededRng(42);
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const sampled = rng.sample(items, 3);
      expect(sampled).toHaveLength(3);
    });

    it('should return unique elements', () => {
      const rng = new SeededRng(42);
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const sampled = rng.sample(items, 5);
      const unique = new Set(sampled);
      expect(unique.size).toBe(5);
    });

    it('should return all elements when count >= length', () => {
      const rng = new SeededRng(42);
      const items = [1, 2, 3];
      const sampled = rng.sample(items, 10);
      expect(sampled).toHaveLength(3);
      expect(new Set(sampled)).toEqual(new Set(items));
    });

    it('should not mutate the input', () => {
      const rng = new SeededRng(42);
      const items = [1, 2, 3, 4, 5];
      const original = [...items];
      rng.sample(items, 3);
      expect(items).toEqual(original);
    });

    it('should be deterministic', () => {
      const items = ['a', 'b', 'c', 'd', 'e'];
      const rng1 = new SeededRng(42);
      const rng2 = new SeededRng(42);
      expect(rng1.sample(items, 3)).toEqual(rng2.sample(items, 3));
    });
  });
});
