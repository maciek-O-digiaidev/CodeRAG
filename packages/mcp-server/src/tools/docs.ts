import { z } from 'zod';
import type { HybridSearch, SearchResult, ReRanker } from '@coderag/core';

export const docsInputSchema = z.object({
  query: z.string().min(1, 'query must not be empty'),
  source: z.enum(['markdown', 'confluence', 'all']).optional().default('all'),
  file_path: z.string().refine(
    (s) => !s.includes('..'),
    'file_path must not contain path traversal',
  ).optional(),
  top_k: z.number().int().positive().max(100).optional().default(10),
});

export type DocsInput = z.infer<typeof docsInputSchema>;

export interface DocsToolResult {
  file_path: string;
  heading: string;
  content: string;
  nl_summary: string;
  score: number;
  source: 'markdown' | 'confluence' | 'unknown';
}

function inferSource(filePath: string): 'markdown' | 'confluence' | 'unknown' {
  if (filePath.endsWith('.md') || filePath.endsWith('.mdx')) {
    return 'markdown';
  }
  if (filePath.startsWith('confluence://') || filePath.includes('/confluence/')) {
    return 'confluence';
  }
  return 'unknown';
}

function formatDocResult(result: SearchResult): DocsToolResult {
  const filePath = result.chunk?.filePath ?? '';
  return {
    file_path: filePath,
    heading: result.metadata?.docTitle ?? result.metadata?.name ?? '',
    content: result.content,
    nl_summary: result.nlSummary,
    score: result.score,
    source: inferSource(filePath),
  };
}

export async function handleDocs(
  args: Record<string, unknown>,
  hybridSearch: HybridSearch | null,
  reranker: ReRanker | null = null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = docsInputSchema.safeParse(args);
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

  const { query, source, file_path, top_k } = parsed.data;

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

    // Filter to doc chunks only
    results = results.filter(
      (r) => r.metadata?.chunkType === 'doc',
    );

    // Filter by source type
    if (source !== 'all') {
      results = results.filter((r) => {
        const filePath = r.chunk?.filePath ?? '';
        const detectedSource = inferSource(filePath);
        return detectedSource === source;
      });
    }

    // Filter by file path
    if (file_path) {
      results = results.filter(
        (r) => r.chunk?.filePath?.includes(file_path),
      );
    }

    // Re-rank results if reranker is available
    if (reranker && results.length > 0) {
      const rerankResult = await reranker.rerank(query, results);
      if (rerankResult.isOk()) {
        results = rerankResult.value;
      }
      // If reranking fails, fall back to original results (don't fail the search)
    }

    const formatted = results.map(formatDocResult);

    return {
      content: [{ type: 'text', text: JSON.stringify({ results: formatted }) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'Docs search failed', message }),
        },
      ],
    };
  }
}
