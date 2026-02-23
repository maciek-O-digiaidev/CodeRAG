import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleEmbeddingProvider } from './openai-compatible-embedding-provider.js';
import { EmbedError } from '../types/provider.js';

describe('OpenAICompatibleEmbeddingProvider', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------- Constructor / Config ----------

  describe('constructor / config', () => {
    it('should use default config values when none provided', () => {
      const provider = new OpenAICompatibleEmbeddingProvider();
      expect(provider.dimensions).toBe(768);
    });

    it('should accept custom config values', () => {
      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'http://remote:9999/v1',
        model: 'custom-model',
        dimensions: 384,
        apiKey: 'sk-test-key',
        maxBatchSize: 50,
      });
      expect(provider.dimensions).toBe(384);
    });

    it('should merge partial config with defaults', () => {
      const provider = new OpenAICompatibleEmbeddingProvider({ dimensions: 512 });
      expect(provider.dimensions).toBe(512);
    });

    it('should strip trailing slashes from baseUrl', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ index: 0, embedding: [0.1, 0.2] }],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'http://localhost:1234/v1///',
      });
      await provider.embed(['test']);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/embeddings',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // ---------- Successful Embedding ----------

  describe('embed — success', () => {
    it('should return embeddings on success', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          object: 'list',
          data: [
            { object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] },
            { object: 'embedding', index: 1, embedding: [0.4, 0.5, 0.6] },
          ],
          model: 'nomic-embed-text',
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider();
      const result = await provider.embed(['hello', 'world']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ]);
      }
    });

    it('should return empty array for empty input', async () => {
      const provider = new OpenAICompatibleEmbeddingProvider();
      const result = await provider.embed([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should sort response data by index for correct ordering', async () => {
      // Simulate out-of-order response
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            { index: 2, embedding: [0.7, 0.8] },
            { index: 0, embedding: [0.1, 0.2] },
            { index: 1, embedding: [0.4, 0.5] },
          ],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider();
      const result = await provider.embed(['a', 'b', 'c']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([
          [0.1, 0.2],
          [0.4, 0.5],
          [0.7, 0.8],
        ]);
      }
    });
  });

  // ---------- Request format ----------

  describe('embed — request format', () => {
    it('should POST to {baseUrl}/embeddings with correct body', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ index: 0, embedding: [1, 2, 3] }],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'http://localhost:11434/v1',
        model: 'nomic-embed-text',
      });
      await provider.embed(['test']);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: ['test'],
            model: 'nomic-embed-text',
          }),
        }),
      );
    });

    it('should include Authorization header when apiKey is provided', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ index: 0, embedding: [1, 2, 3] }],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-key-123',
        model: 'text-embedding-3-small',
      });
      await provider.embed(['test']);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk-test-key-123',
          },
        }),
      );
    });

    it('should NOT include Authorization header when apiKey is not provided', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ index: 0, embedding: [1, 2, 3] }],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'http://localhost:1234/v1',
      });
      await provider.embed(['test']);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/embeddings',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should NOT include Authorization header when apiKey is empty string', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ index: 0, embedding: [1, 2, 3] }],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        apiKey: '',
      });
      await provider.embed(['test']);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/embeddings'),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  // ---------- Batch splitting ----------

  describe('embed — batch splitting', () => {
    it('should split texts into batches based on maxBatchSize', async () => {
      const texts = Array.from({ length: 250 }, (_, i) => `text_${i}`);
      const batch1 = Array.from({ length: 100 }, (_, i) => ({
        index: i,
        embedding: [0.1],
      }));
      const batch2 = Array.from({ length: 100 }, (_, i) => ({
        index: i,
        embedding: [0.2],
      }));
      const batch3 = Array.from({ length: 50 }, (_, i) => ({
        index: i,
        embedding: [0.3],
      }));

      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: batch1 }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: batch2 }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: batch3 }),
        } as unknown as Response);

      const provider = new OpenAICompatibleEmbeddingProvider({ maxBatchSize: 100 });
      const result = await provider.embed(texts);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(250);
      }

      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify batch sizes
      const firstCallBody = JSON.parse(
        fetchMock.mock.calls[0]![1]!.body as string,
      ) as { input: string[] };
      const secondCallBody = JSON.parse(
        fetchMock.mock.calls[1]![1]!.body as string,
      ) as { input: string[] };
      const thirdCallBody = JSON.parse(
        fetchMock.mock.calls[2]![1]!.body as string,
      ) as { input: string[] };

      expect(firstCallBody.input).toHaveLength(100);
      expect(secondCallBody.input).toHaveLength(100);
      expect(thirdCallBody.input).toHaveLength(50);
    });

    it('should respect custom maxBatchSize', async () => {
      const texts = Array.from({ length: 15 }, (_, i) => `text_${i}`);

      const fetchMock = vi.mocked(globalThis.fetch);
      // 3 batches of 5
      for (let b = 0; b < 3; b++) {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: Array.from({ length: 5 }, (_, i) => ({
              index: i,
              embedding: [0.1],
            })),
          }),
        } as unknown as Response);
      }

      const provider = new OpenAICompatibleEmbeddingProvider({ maxBatchSize: 5 });
      const result = await provider.embed(texts);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(15);
      }
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should not batch when texts fit in single batch', async () => {
      const texts = Array.from({ length: 50 }, (_, i) => `text_${i}`);
      const batchData = Array.from({ length: 50 }, (_, i) => ({
        index: i,
        embedding: [0.1, 0.2],
      }));

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: batchData }),
      } as unknown as Response);

      const provider = new OpenAICompatibleEmbeddingProvider({ maxBatchSize: 100 });
      const result = await provider.embed(texts);

      expect(result.isOk()).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should stop batching on error in any batch', async () => {
      const texts = Array.from({ length: 200 }, (_, i) => `text_${i}`);

      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: Array.from({ length: 100 }, (_, i) => ({
              index: i,
              embedding: [0.1],
            })),
          }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: vi.fn().mockRejectedValue(new Error('not json')),
        } as unknown as Response);

      const provider = new OpenAICompatibleEmbeddingProvider({ maxBatchSize: 100 });
      const result = await provider.embed(texts);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('503');
      }
    });
  });

  // ---------- Error handling ----------

  describe('embed — error handling', () => {
    it('should return EmbedError on non-200 status', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('no json')),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider();
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('status 500');
      }
    });

    it('should extract error message from JSON error response', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({
          error: {
            message: 'Invalid API key provided',
            type: 'invalid_request_error',
          },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        apiKey: 'bad-key',
      });
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('Invalid API key provided');
        expect(result.error.message).toContain('401');
      }
    });

    it('should return EmbedError on network error (ECONNREFUSED)', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(
        new Error('fetch failed: ECONNREFUSED'),
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'http://localhost:9999/v1',
      });
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('Cannot connect');
        expect(result.error.message).toContain('localhost:9999');
      }
    });

    it('should return EmbedError on timeout', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(
        new Error('TimeoutError: The operation timed out'),
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        timeout: 5000,
      });
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('timed out');
      }
    });

    it('should return EmbedError when data is not an array', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: 'not-an-array',
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider();
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('data is not an array');
      }
    });

    it('should handle non-Error throw gracefully', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue('string error');

      const provider = new OpenAICompatibleEmbeddingProvider();
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('Unknown error');
      }
    });
  });

  // ---------- Compatibility with different servers ----------

  describe('embed — server compatibility', () => {
    it('should work with LM Studio on localhost:1234 (default config)', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
          model: 'nomic-embed-text',
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider();
      const result = await provider.embed(['hello from LM Studio']);

      expect(result.isOk()).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/embeddings',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should work with Ollama OpenAI-compatible endpoint', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'http://localhost:11434/v1',
        model: 'nomic-embed-text',
      });
      const result = await provider.embed(['hello from Ollama']);

      expect(result.isOk()).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/v1/embeddings',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should work with OpenAI API (with API key)', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          object: 'list',
          data: [
            { object: 'embedding', index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) },
          ],
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-proj-xxxxx',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      });
      const result = await provider.embed(['hello from OpenAI']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]).toHaveLength(1536);
      }

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk-proj-xxxxx',
          },
        }),
      );
    });
  });
});
