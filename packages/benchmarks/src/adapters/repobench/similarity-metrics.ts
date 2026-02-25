/**
 * RepoBench-specific similarity metrics.
 *
 * Implements Exact Match and Edit Similarity as defined in the RepoBench paper.
 * Edit Similarity uses normalized Levenshtein distance: 1 - editDistance/maxLen.
 *
 * These metrics complement the standard IR metrics (P@K, MRR, nDCG) by
 * measuring how close retrieved code is to the expected gold snippets.
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses dynamic programming with O(min(m,n)) space optimization.
 * Operates on characters (not lines) for fine-grained similarity.
 */
export function editDistance(a: string, b: string): number {
  // Optimize: ensure a is the shorter string for O(min(m,n)) space
  if (a.length > b.length) {
    return editDistance(b, a);
  }

  const m = a.length;
  const n = b.length;

  // Use two rows instead of full matrix
  let previousRow = new Array<number>(m + 1);
  let currentRow = new Array<number>(m + 1);

  // Initialize first row
  for (let j = 0; j <= m; j++) {
    previousRow[j] = j;
  }

  for (let i = 1; i <= n; i++) {
    currentRow[0] = i;

    for (let j = 1; j <= m; j++) {
      const bChar = b[i - 1];
      const aChar = a[j - 1];
      const cost = aChar === bChar ? 0 : 1;

      const deletion = (previousRow[j] ?? 0) + 1;
      const insertion = (currentRow[j - 1] ?? 0) + 1;
      const substitution = (previousRow[j - 1] ?? 0) + cost;

      currentRow[j] = Math.min(deletion, insertion, substitution);
    }

    // Swap rows
    [previousRow, currentRow] = [currentRow, previousRow];
  }

  return previousRow[m] ?? 0;
}

/**
 * Compute edit similarity between two strings.
 *
 * Formula: 1 - editDistance(a, b) / max(len(a), len(b))
 *
 * Returns 1.0 for identical strings, 0.0 for completely different strings.
 * Returns 1.0 when both strings are empty (vacuously similar).
 */
export function editSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) {
    return 1.0;
  }

  const maxLen = Math.max(a.length, b.length);
  const distance = editDistance(a, b);

  return 1.0 - distance / maxLen;
}

/**
 * Check if two code strings are an exact match.
 *
 * Comparison is done after normalizing whitespace:
 * - Trim leading/trailing whitespace
 * - Normalize internal whitespace sequences to single spaces
 *
 * This accounts for trivial formatting differences.
 */
export function exactMatch(predicted: string, gold: string): boolean {
  return normalizeWhitespace(predicted) === normalizeWhitespace(gold);
}

/**
 * Normalize whitespace in a code string for comparison.
 * Trims and collapses internal whitespace runs to single spaces.
 */
export function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Compute Exact Match rate across multiple prediction/gold pairs.
 *
 * @param pairs - Array of [predicted, gold] string pairs
 * @returns Fraction of exact matches (0.0 to 1.0)
 */
export function exactMatchRate(
  pairs: readonly (readonly [string, string])[],
): number {
  if (pairs.length === 0) return 0;

  let matches = 0;
  for (const [predicted, gold] of pairs) {
    if (exactMatch(predicted, gold)) {
      matches++;
    }
  }

  return matches / pairs.length;
}

/**
 * Compute average Edit Similarity across multiple prediction/gold pairs.
 *
 * @param pairs - Array of [predicted, gold] string pairs
 * @returns Average edit similarity (0.0 to 1.0)
 */
export function averageEditSimilarity(
  pairs: readonly (readonly [string, string])[],
): number {
  if (pairs.length === 0) return 0;

  let total = 0;
  for (const [predicted, gold] of pairs) {
    total += editSimilarity(predicted, gold);
  }

  return total / pairs.length;
}
