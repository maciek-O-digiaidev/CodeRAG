/**
 * Pure information retrieval metric functions.
 *
 * All functions are stateless and have no side effects.
 * They accept generic string arrays for retrieved/relevant IDs and
 * return numeric metric values.
 *
 * Includes standard IR metrics (Precision@K, Recall@K, MRR, nDCG@K, MAP)
 * and RAGAS-inspired context metrics (context_precision, context_recall).
 */

/**
 * Precision@K: fraction of top-K retrieved items that are relevant.
 *
 * Formula: |retrieved[:K] intersect relevant| / K
 *
 * Returns 0 when K <= 0 or retrieved is empty.
 * Penalizes systems that return fewer than K results (denominator is always K).
 */
export function precisionAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (k <= 0 || retrieved.length === 0) return 0;

  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const item of topK) {
    if (relevant.has(item)) {
      hits++;
    }
  }

  return hits / k;
}

/**
 * Recall@K: fraction of relevant items found in the top-K retrieved items.
 *
 * Formula: |retrieved[:K] intersect relevant| / |relevant|
 *
 * Returns 0 when relevant is empty or K <= 0.
 */
export function recallAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (k <= 0 || relevant.size === 0) return 0;

  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const item of topK) {
    if (relevant.has(item)) {
      hits++;
    }
  }

  return hits / relevant.size;
}

/**
 * Mean Reciprocal Rank (MRR): 1 / rank of the first relevant result.
 *
 * Returns 0 if no relevant item is found in the retrieved list.
 */
export function mrr(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
): number {
  for (let i = 0; i < retrieved.length; i++) {
    const item = retrieved[i];
    if (item !== undefined && relevant.has(item)) {
      return 1 / (i + 1);
    }
  }

  return 0;
}

/**
 * Normalized Discounted Cumulative Gain at position K (nDCG@K).
 *
 * Uses binary relevance (1 if relevant, 0 otherwise).
 * DCG = sum(rel_i / log2(i + 1)) for i in 1..K
 * nDCG = DCG / ideal_DCG
 *
 * Returns 0 when relevant is empty or K <= 0.
 */
export function ndcgAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (k <= 0 || relevant.size === 0) return 0;

  const topK = retrieved.slice(0, k);

  // DCG: sum of 1 / log2(rank + 1) for relevant items
  // rank is 1-based, so log2(rank + 1) = log2(i + 2) for 0-based index i
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const item = topK[i];
    if (item !== undefined && relevant.has(item)) {
      dcg += 1 / Math.log2(i + 2);
    }
  }

  // Ideal DCG: all relevant items ranked at the top
  const idealCount = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * Mean Average Precision (MAP): mean of precision at each relevant position.
 *
 * For each relevant item found in the retrieved list, compute precision
 * at that position, then average across all relevant items.
 *
 * Returns 0 when relevant is empty or retrieved is empty.
 */
export function averagePrecision(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
): number {
  if (relevant.size === 0 || retrieved.length === 0) return 0;

  let sumPrecision = 0;
  let relevantFound = 0;

  for (let i = 0; i < retrieved.length; i++) {
    const item = retrieved[i];
    if (item !== undefined && relevant.has(item)) {
      relevantFound++;
      // Precision at position i+1 (1-based)
      sumPrecision += relevantFound / (i + 1);
    }
  }

  return sumPrecision / relevant.size;
}

/**
 * Context Precision (RAGAS-inspired):
 * Weighted precision that penalizes irrelevant chunks appearing before relevant ones.
 *
 * For each position i (1-based), if the item is relevant:
 *   weight_i = precision@i = (# relevant in top-i) / i
 *
 * context_precision = sum(weight_i for relevant items) / |relevant found|
 *
 * This metric rewards systems that rank relevant chunks before irrelevant ones.
 * Returns 0 when no relevant items are found or retrieved is empty.
 */
export function contextPrecision(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
): number {
  if (relevant.size === 0 || retrieved.length === 0) return 0;

  let sumWeightedPrecision = 0;
  let relevantFound = 0;

  for (let i = 0; i < retrieved.length; i++) {
    const item = retrieved[i];
    if (item !== undefined && relevant.has(item)) {
      relevantFound++;
      // Precision at position i+1 (1-based)
      sumWeightedPrecision += relevantFound / (i + 1);
    }
  }

  if (relevantFound === 0) return 0;
  return sumWeightedPrecision / relevantFound;
}

/**
 * Context Recall (RAGAS-inspired, simplified text-based):
 * Fraction of expected information strings found in the actual context.
 *
 * For each string in expectedInfo, check if it appears (case-insensitive)
 * in the actualContext string.
 *
 * Returns null if no expectedInfo is provided (metric not applicable).
 * Returns 0 if actualContext is empty and expectedInfo is non-empty.
 */
export function contextRecall(
  expectedInfo: readonly string[],
  actualContext: string,
): number | null {
  if (expectedInfo.length === 0) return null;
  if (actualContext.length === 0) return 0;

  const lowerContext = actualContext.toLowerCase();
  let found = 0;

  for (const info of expectedInfo) {
    if (lowerContext.includes(info.toLowerCase())) {
      found++;
    }
  }

  return found / expectedInfo.length;
}
