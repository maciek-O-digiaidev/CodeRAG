/**
 * Information retrieval metrics for evaluating search quality.
 *
 * All functions are pure math with no side effects.
 */

/**
 * Precision@K: fraction of top-k slots that contain relevant items.
 * Uses standard IR definition where denominator is always k,
 * not the number of items retrieved (penalizes runners that return fewer than k results).
 * Returns 0 when k <= 0 or retrieved is empty.
 */
export function precisionAtK(
  retrieved: string[],
  relevant: string[],
  k: number,
): number {
  if (k <= 0 || retrieved.length === 0) return 0;

  const topK = retrieved.slice(0, k);
  const relevantSet = new Set(relevant);
  const hits = topK.filter((item) => relevantSet.has(item)).length;

  return hits / k;
}

/**
 * Recall@K: fraction of relevant items found in the top-k retrieved items.
 * Returns 0 when relevant is empty.
 */
export function recallAtK(
  retrieved: string[],
  relevant: string[],
  k: number,
): number {
  if (k <= 0 || relevant.length === 0) return 0;

  const topK = retrieved.slice(0, k);
  const relevantSet = new Set(relevant);
  const hits = topK.filter((item) => relevantSet.has(item)).length;

  return hits / relevant.length;
}

/**
 * Mean Reciprocal Rank (MRR): 1 / rank of the first relevant result.
 * Returns 0 if no relevant item is found.
 */
export function meanReciprocalRank(
  retrieved: string[],
  relevant: string[],
): number {
  const relevantSet = new Set(relevant);

  for (let i = 0; i < retrieved.length; i++) {
    if (relevantSet.has(retrieved[i]!)) {
      return 1 / (i + 1);
    }
  }

  return 0;
}

/**
 * Normalized Discounted Cumulative Gain (nDCG) at position k.
 *
 * Uses binary relevance (1 if relevant, 0 otherwise).
 * Returns 0 when relevant is empty or k <= 0.
 */
export function ndcg(
  retrieved: string[],
  relevant: string[],
  k: number,
): number {
  if (k <= 0 || relevant.length === 0) return 0;

  const relevantSet = new Set(relevant);
  const topK = retrieved.slice(0, k);

  // DCG: sum of 1 / log2(rank + 1) for relevant items
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevantSet.has(topK[i]!)) {
      dcg += 1 / Math.log2(i + 2); // i+2 because rank starts at 1 and log2(1)=0
    }
  }

  // Ideal DCG: all relevant items ranked at the top
  const idealCount = Math.min(relevant.length, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}
