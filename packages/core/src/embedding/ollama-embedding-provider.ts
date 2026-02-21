import { ok, err, type Result } from 'neverthrow';
import { EmbedError, type EmbeddingProvider } from '../types/provider.js';

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
  dimensions: number;
  timeout: number;
}

const DEFAULT_CONFIG: OllamaEmbeddingConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'nomic-embed-text',
  dimensions: 768,
  timeout: 30_000,
};

const BATCH_SIZE = 50;

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly config: OllamaEmbeddingConfig;

  constructor(config?: Partial<OllamaEmbeddingConfig>) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    // Strip trailing slashes from baseUrl
    merged.baseUrl = merged.baseUrl.replace(/\/+$/, '');
    this.config = merged;
  }

  get dimensions(): number {
    return this.config.dimensions;
  }

  async embed(texts: string[]): Promise<Result<number[][], EmbedError>> {
    if (texts.length === 0) {
      return ok([]);
    }

    try {
      const batches = this.splitIntoBatches(texts, BATCH_SIZE);
      const allEmbeddings: number[][] = [];

      for (const batch of batches) {
        const result = await this.embedBatch(batch);
        if (result.isErr()) {
          return err(result.error);
        }
        allEmbeddings.push(...result.value);
      }

      return ok(allEmbeddings);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new EmbedError(`Embedding request failed: ${message}`));
    }
  }

  private async embedBatch(
    texts: string[],
  ): Promise<Result<number[][], EmbedError>> {
    try {
      const response = await globalThis.fetch(
        `${this.config.baseUrl}/api/embed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.model,
            input: texts,
          }),
          signal: AbortSignal.timeout(this.config.timeout),
        },
      );

      if (!response.ok) {
        return err(
          new EmbedError(
            `Ollama embed API returned status ${response.status}: ${response.statusText}`,
          ),
        );
      }

      const data = (await response.json()) as OllamaEmbedResponse;
      if (!Array.isArray(data.embeddings)) {
        return err(new EmbedError('Invalid response: embeddings is not an array'));
      }
      return ok(data.embeddings);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new EmbedError(`Ollama embed request failed: ${message}`));
    }
  }

  private splitIntoBatches(texts: string[], batchSize: number): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }
    return batches;
  }
}
