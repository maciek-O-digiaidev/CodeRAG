import { Router } from 'express';
import { z } from 'zod';
import {
  TokenBudgetOptimizer,
  type HybridSearch,
  type ContextExpander,
} from '@coderag/core';

export const contextRequestSchema = z.object({
  file_path: z.string().min(1, 'file_path must not be empty').refine(
    (s) => !s.includes('..'),
    'file_path must not contain path traversal',
  ),
  include_tests: z.boolean().optional().default(true),
  include_interfaces: z.boolean().optional().default(true),
  max_tokens: z.number().int().positive().max(128000).optional().default(8000),
});

export type ContextRequest = z.infer<typeof contextRequestSchema>;

export interface ContextRouteDeps {
  readonly hybridSearch: HybridSearch | null;
  readonly contextExpander: ContextExpander | null;
}

export function createContextRouter(deps: ContextRouteDeps): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = contextRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    if (!deps.hybridSearch || !deps.contextExpander) {
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Services not initialized. Run indexing first.',
      });
      return;
    }

    try {
      const { file_path, max_tokens } = parsed.data;

      // Search for chunks matching the file_path
      const searchResult = await deps.hybridSearch.search(file_path, { topK: 20 });

      if (searchResult.isErr()) {
        res.status(500).json({
          error: 'Search Failed',
          message: searchResult.error.message,
        });
        return;
      }

      // Filter to results that match the file path
      let results = searchResult.value.filter(
        (r) => r.chunk?.filePath?.includes(file_path),
      );

      // Apply optional filters
      if (!parsed.data.include_tests) {
        results = results.filter(
          (r) => !r.chunk?.filePath?.includes('.test.') &&
                 !r.chunk?.filePath?.includes('.spec.') &&
                 !r.chunk?.filePath?.includes('__tests__'),
        );
      }

      if (!parsed.data.include_interfaces) {
        results = results.filter(
          (r) => r.metadata?.chunkType !== 'interface' &&
                 r.metadata?.chunkType !== 'type_alias',
        );
      }

      if (results.length === 0) {
        res.json({
          context: '',
          token_count: 0,
          truncated: false,
          primary_chunks: 0,
          related_chunks: 0,
          message: `No chunks found for file: ${file_path}`,
        });
        return;
      }

      // Expand context via dependency graph
      const expanded = deps.contextExpander.expand(results);

      // Assemble within token budget
      const optimizer = new TokenBudgetOptimizer({ maxTokens: max_tokens });
      const assembled = optimizer.assemble(expanded);

      res.json({
        context: assembled.content,
        token_count: assembled.tokenCount,
        truncated: assembled.truncated,
        primary_chunks: assembled.primaryChunks.length,
        related_chunks: assembled.relatedChunks.length,
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
