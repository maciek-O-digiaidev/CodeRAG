import { z } from 'zod';
import type { HybridSearch, ContextExpander, SearchResult } from '@code-rag/core';

export const explainInputSchema = z.object({
  file_path: z.string().min(1, 'file_path must not be empty').refine(
    (s) => !s.includes('..'),
    'file_path must not contain path traversal',
  ).optional(),
  name: z.string().min(1, 'name must not be empty').optional(),
  detail_level: z.enum(['brief', 'detailed']).optional().default('detailed'),
}).refine(
  (data) => data.file_path !== undefined || data.name !== undefined,
  'At least one of file_path or name must be provided',
);

export type ExplainInput = z.infer<typeof explainInputSchema>;

interface ChunkExplanation {
  file_path: string;
  chunk_type: string;
  name: string;
  nl_summary: string;
  code?: string;
}

interface ExplainResult {
  explanation: {
    chunks: ChunkExplanation[];
    detail_level: string;
    related_symbols?: string[];
  };
  chunks_found: number;
}

function formatChunk(
  result: SearchResult,
  detailLevel: 'brief' | 'detailed',
): ChunkExplanation {
  const explanation: ChunkExplanation = {
    file_path: result.chunk?.filePath ?? '',
    chunk_type: result.metadata?.chunkType ?? 'unknown',
    name: result.metadata?.name ?? '',
    nl_summary: result.nlSummary,
  };

  if (detailLevel === 'detailed') {
    explanation.code = result.content;
  }

  return explanation;
}

export async function handleExplain(
  args: Record<string, unknown>,
  hybridSearch: HybridSearch | null,
  contextExpander: ContextExpander | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const parsed = explainInputSchema.safeParse(args);
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
            explanation: { chunks: [], detail_level: parsed.data.detail_level },
            chunks_found: 0,
            message: 'Services not initialized. Run indexing first.',
          }),
        },
      ],
    };
  }

  const { file_path, name, detail_level } = parsed.data;

  try {
    let results: SearchResult[] = [];

    if (name) {
      // Search by function/class/method name
      const searchResult = await hybridSearch.search(name, { topK: 5 });

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

      // Filter to chunks whose name matches
      results = searchResult.value.filter(
        (r) => r.metadata?.name?.toLowerCase().includes(name.toLowerCase()),
      );
    } else if (file_path) {
      // Search by file path
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

      // Filter to chunks in the specified file
      results = searchResult.value.filter(
        (r) => r.chunk?.filePath?.includes(file_path),
      );
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              explanation: { chunks: [], detail_level },
              chunks_found: 0,
              message: name
                ? `No chunks found matching name: ${name}`
                : `No chunks found for file: ${file_path}`,
            }),
          },
        ],
      };
    }

    const chunks = results.map((r) => formatChunk(r, detail_level));

    const result: ExplainResult = {
      explanation: {
        chunks,
        detail_level,
      },
      chunks_found: results.length,
    };

    // Add related symbols from context expander when in detailed mode
    if (detail_level === 'detailed' && contextExpander) {
      const expanded = await contextExpander.expand(results);
      const relatedSymbols = expanded.relatedChunks.map((related) => {
        return related.chunk.metadata.name ?? related.chunk.chunk?.filePath ?? 'unknown';
      });
      if (relatedSymbols.length > 0) {
        result.explanation.related_symbols = relatedSymbols;
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'Explain failed', message }),
        },
      ],
    };
  }
}
