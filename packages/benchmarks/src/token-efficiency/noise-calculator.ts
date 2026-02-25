/**
 * Noise ratio calculator for token efficiency benchmarks.
 *
 * Computes the fraction of tokens that belong to relevant results
 * vs. the total tokens returned, measuring how much "noise" is
 * included in the retrieved context.
 *
 * A noise ratio of 0.0 means all tokens are relevant (no noise).
 * A noise ratio of 1.0 means no tokens are relevant (all noise).
 */

/** Approximate token count using the text.length / 4 heuristic. */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compute noise ratio: 1 - (relevant_tokens / total_tokens).
 *
 * Returns 0 when total tokens is 0 (no output = no noise).
 * Returns 1 when there are tokens but none are relevant.
 *
 * @param relevantTokens - Tokens belonging to relevant chunks.
 * @param totalTokens - Total tokens in the retrieved context.
 */
export function computeNoiseRatio(
  relevantTokens: number,
  totalTokens: number,
): number {
  if (totalTokens <= 0) return 0;
  if (relevantTokens <= 0) return 1;
  const ratio = 1 - relevantTokens / totalTokens;
  return Math.max(0, Math.min(1, ratio));
}

/**
 * Given retrieved chunk IDs with their token counts and a set of relevant IDs,
 * compute the total tokens, relevant tokens, and noise ratio.
 */
export function computeTokenBreakdown(
  chunks: readonly ChunkTokenInfo[],
  relevantIds: ReadonlySet<string>,
): TokenBreakdown {
  let totalTokens = 0;
  let relevantTokens = 0;

  for (const chunk of chunks) {
    totalTokens += chunk.tokenCount;
    if (relevantIds.has(chunk.id)) {
      relevantTokens += chunk.tokenCount;
    }
  }

  return {
    totalTokens,
    relevantTokens,
    noiseRatio: computeNoiseRatio(relevantTokens, totalTokens),
  };
}

/** Token information for a single chunk. */
export interface ChunkTokenInfo {
  readonly id: string;
  readonly tokenCount: number;
}

/** Result of a token breakdown analysis. */
export interface TokenBreakdown {
  readonly totalTokens: number;
  readonly relevantTokens: number;
  readonly noiseRatio: number;
}
