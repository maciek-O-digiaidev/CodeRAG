/**
 * Seeded pseudo-random number generator (PRNG).
 *
 * Uses a Lehmer / Park-Miller LCG (Linear Congruential Generator)
 * for deterministic, reproducible random number generation.
 * Same seed always produces the same sequence.
 *
 * No external dependencies. Pure functions + class state only.
 */

/** LCG multiplier (Park-Miller) */
const LCG_MULTIPLIER = 48271;
/** LCG modulus (Mersenne prime 2^31 - 1) */
const LCG_MODULUS = 2147483647;

/**
 * Seeded PRNG using Park-Miller LCG.
 * Deterministic: same seed always produces the same sequence.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Ensure state is in valid range [1, LCG_MODULUS - 1]
    this.state = ((seed % (LCG_MODULUS - 1)) + (LCG_MODULUS - 1)) % (LCG_MODULUS - 1) + 1;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state * LCG_MULTIPLIER) % LCG_MODULUS;
    return (this.state - 1) / (LCG_MODULUS - 1);
  }

  /** Returns an integer in [min, max] (inclusive). */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Returns a random boolean with the given probability of true. */
  nextBool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /** Picks a random element from a non-empty readonly array. */
  pick<T>(items: readonly T[]): T {
    const index = this.nextInt(0, items.length - 1);
    return items[index]!;
  }

  /** Shuffles array in place using Fisher-Yates and returns it. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const temp = items[i]!;
      items[i] = items[j]!;
      items[j] = temp;
    }
    return items;
  }

  /** Returns a subset of items of the given size. */
  sample<T>(items: readonly T[], count: number): T[] {
    const copy = [...items];
    this.shuffle(copy);
    return copy.slice(0, Math.min(count, copy.length));
  }
}
