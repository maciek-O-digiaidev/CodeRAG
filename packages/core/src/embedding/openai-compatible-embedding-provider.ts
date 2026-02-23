import { ok, err, type Result } from 'neverthrow';
import { EmbedError, type EmbeddingProvider } from '../types/provider.js';

export interface OpenAICompatibleEmbeddingConfig {
  baseUrl: string;
  model: string;
  dimensions: number;
  apiKey?: string;
  maxBatchSize: number;
  timeout: number;
}

const DEFAULT_CONFIG: OpenAICompatibleEmbeddingConfig = {
  baseUrl: 'http://localhost:1234/v1',
  model: 'nomic-embed-text',
  dimensions: 768,
  maxBatchSize: 100,
  timeout: 60_000,
};

interface OpenAIEmbeddingObject {
  object: string;
  index: number;
  embedding: number[];
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: OpenAIEmbeddingObject[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  private readonly config: OpenAICompatibleEmbeddingConfig;

  constructor(config?: Partial<OpenAICompatibleEmbeddingConfig>) {
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
      const batches = this.splitIntoBatches(texts, this.config.maxBatchSize);
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await globalThis.fetch(
        `${this.config.baseUrl}/embeddings`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: texts,
            model: this.config.model,
          }),
          signal: AbortSignal.timeout(this.config.timeout),
        },
      );

      if (!response.ok) {
        const errorMessage = await this.extractErrorMessage(response);
        return err(
          new EmbedError(
            `OpenAI-compatible embedding API returned status ${response.status}: ${errorMessage}`,
          ),
        );
      }

      const data = (await response.json()) as OpenAIEmbeddingResponse;
      if (!Array.isArray(data.data)) {
        return err(new EmbedError('Invalid response: data is not an array'));
      }

      // Sort by index to ensure correct ordering
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      const embeddings = sorted.map((item) => item.embedding);

      return ok(embeddings);
    } catch (error) {
      if (error instanceof EmbedError) {
        return err(error);
      }
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      // Provide user-friendly messages for common connection errors
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        return err(
          new EmbedError(
            `Cannot connect to embedding server at ${this.config.baseUrl}. ` +
            `Ensure the server is running and accessible. Original error: ${message}`,
          ),
        );
      }

      if (message.includes('TimeoutError') || message.includes('timed out') || message.includes('abort')) {
        return err(
          new EmbedError(
            `Request to embedding server at ${this.config.baseUrl} timed out after ${this.config.timeout}ms. ` +
            `Try increasing the timeout or reducing the batch size. Original error: ${message}`,
          ),
        );
      }

      return err(new EmbedError(`OpenAI-compatible embed request failed: ${message}`));
    }
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as OpenAIErrorResponse;
      if (body.error?.message) {
        return body.error.message;
      }
    } catch {
      // Response body is not JSON — fall through to statusText
    }
    return response.statusText;
  }

  private splitIntoBatches(texts: string[], batchSize: number): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }
    return batches;
  }
}
