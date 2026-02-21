import { z } from 'zod';
import {
  TokenBudgetOptimizer,
  type HybridSearch,
  type ContextExpander,
} from '@coderag/core';

export const contextInputSchema = z.object({
  file_path: z.string().min(1, 'file_path must not be empty'),
  include_tests: z.boolean().optional().default(true),
  include_interfaces: z.boolean().optional().default(true),
  max_tokens: z.number().int().positive().optional().default(8000),
});

export type ContextInput = z.infer<typeof contextInputSchema>;

export async function handleContext(
  args: Record<string, unknown>,
  hybridSearch: HybridSearch | null,
  contextExpander: ContextExpander | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = contextInputSchema.safeParse(args);
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

  if (!hybridSearch || !contextExpander) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            context: '',
            message: 'Services not initialized. Run indexing first.',
          }),
        },
      ],
    };
  }

  const { file_path, max_tokens } = parsed.data;

  try {
    // Step 1: Search for chunks matching the file_path
    const searchResult = await hybridSearch.search(file_path, { topK: 20 });

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

    // Filter to results that match the file path
    let results = searchResult.value.filter(
      (r) => r.chunk?.filePath?.includes(file_path),
    );

    // Apply optional filters for tests and interfaces
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
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              context: '',
              message: `No chunks found for file: ${file_path}`,
            }),
          },
        ],
      };
    }

    // Step 2: Expand context via dependency graph
    const expanded = contextExpander.expand(results);

    // Step 3: Assemble within token budget (use caller's max_tokens)
    const optimizer = new TokenBudgetOptimizer({ maxTokens: max_tokens });
    const assembled = optimizer.assemble(expanded);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            context: assembled.content,
            token_count: assembled.tokenCount,
            truncated: assembled.truncated,
            primary_chunks: assembled.primaryChunks.length,
            related_chunks: assembled.relatedChunks.length,
          }),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'Context assembly failed', message }),
        },
      ],
    };
  }
}
