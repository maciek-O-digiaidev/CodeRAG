import { ok, err, type Result } from 'neverthrow';
import type { SearchResult } from '../types/search.js';
import { ReRankerError, type ReRanker } from '../types/provider.js';

export type { ReRanker };
export { ReRankerError };

export interface CrossEncoderConfig {
  model: string;
  baseUrl?: string;
  topN: number;
  timeout?: number;
}

interface OllamaGenerateResponse {
  response: string;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_TIMEOUT = 30_000;
/** Neutral midpoint score assigned when scoring fails for a single result. */
const DEFAULT_SCORE = 50;
const MAX_QUERY_LENGTH = 500;
const MAX_CONTENT_LENGTH = 2000;

function buildScoringPrompt(query: string, result: SearchResult): string {
  const chunkType = result.metadata?.chunkType ?? 'unknown';
  const name = result.metadata?.name ?? 'unnamed';
  const truncatedQuery = query.length > MAX_QUERY_LENGTH
    ? query.slice(0, MAX_QUERY_LENGTH) + '...'
    : query;
  const truncatedContent = result.content.length > MAX_CONTENT_LENGTH
    ? result.content.slice(0, MAX_CONTENT_LENGTH) + '...'
    : result.content;
  return [
    'Rate relevance 0-100 of this code to the query. Reply with ONLY the number.',
    `<query>${truncatedQuery}</query>`,
    `<code type="${chunkType}" name="${name}">`,
    truncatedContent,
    '</code>',
    'Score:',
  ].join('\n');
}

function parseScore(response: string): number {
  const match = response.match(/-?\d+/);
  if (!match) {
    return DEFAULT_SCORE;
  }
  const score = parseInt(match[0]!, 10);
  return Math.max(0, Math.min(100, score));
}

export class CrossEncoderReRanker implements ReRanker {
  private readonly config: Required<CrossEncoderConfig>;

  constructor(config: CrossEncoderConfig) {
    this.config = {
      model: config.model,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      topN: config.topN,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    };
  }

  async rerank(
    query: string,
    results: SearchResult[],
  ): Promise<Result<SearchResult[], ReRankerError>> {
    if (results.length === 0) {
      return ok([]);
    }

    const topN = Math.min(this.config.topN, results.length);
    const toRerank = results.slice(0, topN);
    const remaining = results.slice(topN);

    const scored: Array<{ result: SearchResult; score: number }> = [];

    for (const result of toRerank) {
      const prompt = buildScoringPrompt(query, result);

      try {
        const response = await globalThis.fetch(
          `${this.config.baseUrl}/api/generate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: this.config.model,
              prompt,
              stream: false,
            }),
            signal: AbortSignal.timeout(this.config.timeout),
          },
        );

        if (!response.ok) {
          scored.push({ result, score: DEFAULT_SCORE });
          continue;
        }

        const data = (await response.json()) as OllamaGenerateResponse;
        const score = parseScore(data.response);
        scored.push({ result, score });
      } catch (error) {
        // If no results have been scored yet, Ollama is likely unreachable
        if (scored.length === 0) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          return err(
            new ReRankerError(`Ollama request failed: ${message}`),
          );
        }
        // Transient error on a later call — assign default score and continue
        scored.push({ result, score: DEFAULT_SCORE });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const reranked = scored.map((s) => s.result);
    return ok([...reranked, ...remaining]);
  }
}
