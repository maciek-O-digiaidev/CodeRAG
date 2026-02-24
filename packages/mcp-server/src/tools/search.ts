import { z } from 'zod';
import type { HybridSearch, SearchResult } from '@code-rag/core';
import type { ReRanker } from '@code-rag/core';

export const searchInputSchema = z.object({
  query: z.string().min(1, 'query must not be empty'),
  language: z.string().optional(),
  file_path: z.string().refine(
    (s) => !s.includes('..'),
    'file_path must not contain path traversal',
  ).optional(),
  chunk_type: z.string().optional(),
  top_k: z.number().int().positive().max(100).optional().default(10),
});

export type SearchInput = z.infer<typeof searchInputSchema>;

export interface SearchToolResult {
  file_path: string;
  chunk_type: string;
  name: string;
  content: string;
  nl_summary: string;
  score: number;
}

function formatResult(result: SearchResult): SearchToolResult {
  return {
    file_path: result.chunk?.filePath ?? '',
    chunk_type: result.metadata?.chunkType ?? 'unknown',
    name: result.metadata?.name ?? '',
    content: result.content,
    nl_summary: result.nlSummary,
    score: result.score,
  };
}

export async function handleSearch(
  args: Record<string, unknown>,
  hybridSearch: HybridSearch | null,
  reranker: ReRanker | null = null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = searchInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Invalid input',
            details: parsed.error.issues,
          }),
        },
      ],
    };
  }

  if (!hybridSearch) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: [],
            message: 'Search index not initialized. Run indexing first.',
          }),
        },
      ],
    };
  }

  const { query, top_k } = parsed.data;

  try {
    const searchResult = await hybridSearch.search(query, { topK: top_k });

    if (searchResult.isErr()) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Search failed',
              message: searchResult.error.message,
            }),
          },
        ],
      };
    }

    let results = searchResult.value;

    // Apply optional filters
    if (parsed.data.language) {
      const lang = parsed.data.language.toLowerCase();
      results = results.filter(
        (r) => r.chunk?.language?.toLowerCase() === lang,
      );
    }

    if (parsed.data.file_path) {
      const fp = parsed.data.file_path;
      results = results.filter(
        (r) => r.chunk?.filePath?.includes(fp),
      );
    }

    if (parsed.data.chunk_type) {
      const ct = parsed.data.chunk_type;
      results = results.filter(
        (r) => r.metadata?.chunkType === ct,
      );
    }

    // Re-rank results if reranker is available
    if (reranker) {
      const rerankResult = await reranker.rerank(query, results);
      if (rerankResult.isOk()) {
        results = rerankResult.value;
      }
      // If reranking fails, fall back to original results (don't fail the search)
    }

    const formatted = results.map(formatResult);

    return {
      content: [{ type: 'text', text: JSON.stringify({ results: formatted }) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'Search failed', message }),
        },
      ],
    };
  }
}
