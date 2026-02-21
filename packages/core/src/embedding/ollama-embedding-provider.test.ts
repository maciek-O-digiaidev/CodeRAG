import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaEmbeddingProvider } from './ollama-embedding-provider.js';
import { EmbedError } from '../types/provider.js';

describe('OllamaEmbeddingProvider', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor / config', () => {
    it('should use default config values when none provided', () => {
      const provider = new OllamaEmbeddingProvider();
      expect(provider.dimensions).toBe(768);
    });

    it('should accept custom config values', () => {
      const provider = new OllamaEmbeddingProvider({
        baseUrl: 'http://remote:9999',
        model: 'custom-model',
        dimensions: 384,
      });
      expect(provider.dimensions).toBe(384);
    });

    it('should merge partial config with defaults', () => {
      const provider = new OllamaEmbeddingProvider({ dimensions: 512 });
      expect(provider.dimensions).toBe(512);
    });
  });

  describe('embed', () => {
    it('should return embeddings on success', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({ embeddings: mockEmbeddings }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed(['hello', 'world']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(mockEmbeddings);
      }

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/embed',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'nomic-embed-text',
            input: ['hello', 'world'],
          }),
        }),
      );
    });

    it('should return empty array for empty input', async () => {
      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should return EmbedError on non-200 status', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('status 500');
      }
    });

    it('should return EmbedError on network error', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });

    it('should handle non-Error throw gracefully', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue('string error');

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed(['hello']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('Unknown error');
      }
    });

    it('should use custom baseUrl and model', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({ embeddings: [[1, 2, 3]] }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const provider = new OllamaEmbeddingProvider({
        baseUrl: 'http://custom:8080',
        model: 'custom-embed',
      });
      await provider.embed(['test']);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://custom:8080/api/embed',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'custom-embed',
            input: ['test'],
          }),
        }),
      );
    });

    it('should batch texts larger than 50 into separate requests', async () => {
      // Create 120 texts (should be 3 batches: 50, 50, 20)
      const texts = Array.from({ length: 120 }, (_, i) => `text_${i}`);
      const batchEmbeddings1 = Array.from({ length: 50 }, () => [0.1, 0.2]);
      const batchEmbeddings2 = Array.from({ length: 50 }, () => [0.3, 0.4]);
      const batchEmbeddings3 = Array.from({ length: 20 }, () => [0.5, 0.6]);

      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ embeddings: batchEmbeddings1 }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ embeddings: batchEmbeddings2 }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ embeddings: batchEmbeddings3 }),
        } as unknown as Response);

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed(texts);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(120);
      }

      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify batch sizes in request bodies
      const firstCallBody = JSON.parse(
        fetchMock.mock.calls[0]![1]!.body as string,
      ) as { input: string[] };
      const secondCallBody = JSON.parse(
        fetchMock.mock.calls[1]![1]!.body as string,
      ) as { input: string[] };
      const thirdCallBody = JSON.parse(
        fetchMock.mock.calls[2]![1]!.body as string,
      ) as { input: string[] };

      expect(firstCallBody.input).toHaveLength(50);
      expect(secondCallBody.input).toHaveLength(50);
      expect(thirdCallBody.input).toHaveLength(20);
    });

    it('should stop batching on error in any batch', async () => {
      const texts = Array.from({ length: 75 }, (_, i) => `text_${i}`);

      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: vi
            .fn()
            .mockResolvedValue({
              embeddings: Array.from({ length: 50 }, () => [0.1]),
            }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        } as unknown as Response);

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed(texts);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EmbedError);
        expect(result.error.message).toContain('503');
      }
    });

    it('should not batch when texts fit in single batch', async () => {
      const texts = Array.from({ length: 50 }, (_, i) => `text_${i}`);
      const mockEmbeddings = Array.from({ length: 50 }, () => [0.1, 0.2]);

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ embeddings: mockEmbeddings }),
      } as unknown as Response);

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.embed(texts);

      expect(result.isOk()).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
