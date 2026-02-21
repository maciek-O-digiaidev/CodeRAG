import { ok, err, type Result } from 'neverthrow';
import type { Chunk } from '../types/chunk.js';
import type { OllamaClient } from './ollama-client.js';

export class EnrichmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrichmentError';
  }
}

function buildPrompt(chunk: Chunk): string {
  return `Summarize this ${chunk.language} code in one sentence. Focus on what it does, not how. Code:\n\`\`\`\n${chunk.content}\n\`\`\``;
}

export class NLEnricher {
  private readonly client: OllamaClient;

  constructor(client: OllamaClient) {
    this.client = client;
  }

  async enrichChunk(chunk: Chunk): Promise<Result<Chunk, EnrichmentError>> {
    const prompt = buildPrompt(chunk);
    const result = await this.client.generate(prompt);

    if (result.isErr()) {
      return err(
        new EnrichmentError(
          `Failed to enrich chunk ${chunk.id}: ${result.error.message}`,
        ),
      );
    }

    return ok({
      ...chunk,
      nlSummary: result.value.trim(),
    });
  }

  async enrichBatch(
    chunks: Chunk[],
    concurrency = 3,
  ): Promise<Result<Chunk[], EnrichmentError>> {
    if (chunks.length === 0) {
      return ok([]);
    }

    const results: Chunk[] = [];
    const errors: EnrichmentError[] = [];

    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((chunk) => this.enrichChunk(chunk)),
      );

      for (const result of batchResults) {
        if (result.isErr()) {
          errors.push(result.error);
        } else {
          results.push(result.value);
        }
      }
    }

    if (errors.length > 0) {
      return err(
        new EnrichmentError(
          `Failed to enrich ${errors.length} chunk(s): ${errors[0]!.message}`,
        ),
      );
    }

    return ok(results);
  }
}
