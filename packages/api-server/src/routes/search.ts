import { Router } from 'express';
import { z } from 'zod';
import type { HybridSearch, SearchResult, ReRanker } from '@code-rag/core';

export const searchRequestSchema = z.object({
  query: z.string().min(1, 'query must not be empty'),
  language: z.string().optional(),
  file_path: z.string().refine(
    (s) => !s.includes('..'),
    'file_path must not contain path traversal',
  ).optional(),
  chunk_type: z.string().optional(),
  top_k: z.number().int().positive().max(100).optional().default(10),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export interface SearchResponseItem {
  file_path: string;
  chunk_type: string;
  name: string;
  content: string;
  nl_summary: string;
  score: number;
}

function formatResult(result: SearchResult): SearchResponseItem {
  return {
    file_path: result.chunk?.filePath ?? '',
    chunk_type: result.metadata?.chunkType ?? 'unknown',
    name: result.metadata?.name ?? '',
    content: result.content,
    nl_summary: result.nlSummary,
    score: result.score,
  };
}

export interface SearchRouteDeps {
  readonly hybridSearch: HybridSearch | null;
  readonly reranker: ReRanker | null;
}

export function createSearchRouter(deps: SearchRouteDeps): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = searchRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    if (!deps.hybridSearch) {
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Search index not initialized. Run indexing first.',
      });
      return;
    }

    try {
      const { query, top_k } = parsed.data;
      const searchResult = await deps.hybridSearch.search(query, { topK: top_k });

      if (searchResult.isErr()) {
        res.status(500).json({
          error: 'Search Failed',
          message: searchResult.error.message,
        });
        return;
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

      // Re-rank if available
      if (deps.reranker) {
        const rerankResult = await deps.reranker.rerank(query, results);
        if (rerankResult.isOk()) {
          results = rerankResult.value;
        }
        // If reranking fails, fall back to original results
      }

      const formatted = results.map(formatResult);

      res.json({
        results: formatted,
        total: formatted.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        error: 'Internal Server Error',
        message,
      });
    }
  });

  return router;
}
