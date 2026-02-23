import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaClient, OllamaError } from './ollama-client.js';

describe('OllamaClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor / config', () => {
    it('should use default config values when none provided', () => {
      const client = new OllamaClient();
      const config = client.currentConfig;

      expect(config.baseUrl).toBe('http://localhost:11434');
      expect(config.model).toBe('qwen2.5-coder:7b');
      expect(config.timeout).toBe(30_000);
      expect(config.maxTokens).toBe(100);
    });

    it('should accept custom config values', () => {
      const client = new OllamaClient({
        baseUrl: 'http://remote:9999',
        model: 'llama3.2',
        timeout: 60_000,
        maxTokens: 200,
      });
      const config = client.currentConfig;

      expect(config.baseUrl).toBe('http://remote:9999');
      expect(config.model).toBe('llama3.2');
      expect(config.timeout).toBe(60_000);
      expect(config.maxTokens).toBe(200);
    });

    it('should merge partial config with defaults', () => {
      const client = new OllamaClient({ model: 'codellama' });
      const config = client.currentConfig;

      expect(config.baseUrl).toBe('http://localhost:11434');
      expect(config.model).toBe('codellama');
      expect(config.timeout).toBe(30_000);
    });
  });

  describe('generate', () => {
    it('should return the response on success', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({ response: 'This function adds two numbers.' }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const client = new OllamaClient();
      const result = await client.generate('Summarize this code');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('This function adds two numbers.');
      }

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen2.5-coder:7b',
            prompt: 'Summarize this code',
            stream: false,
            options: { num_predict: 100 },
          }),
        }),
      );
    });

    it('should return OllamaError on non-200 status', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const client = new OllamaClient();
      const result = await client.generate('Summarize this code');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(OllamaError);
        expect(result.error.message).toContain('status 500');
        expect(result.error.message).toContain('Internal Server Error');
      }
    });

    it('should return OllamaError on network error', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

      const client = new OllamaClient();
      const result = await client.generate('Summarize this code');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(OllamaError);
        expect(result.error.message).toContain('Ollama request failed');
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });

    it('should handle non-Error throw gracefully', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue('string error');

      const client = new OllamaClient();
      const result = await client.generate('Summarize this code');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(OllamaError);
        expect(result.error.message).toContain('Unknown error');
      }
    });
  });

  describe('isAvailable', () => {
    it('should return true on 200 response', async () => {
      const mockResponse = { ok: true, status: 200 };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const client = new OllamaClient();
      const available = await client.isAvailable();

      expect(available).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should return false on network error', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

      const client = new OllamaClient();
      const available = await client.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false on non-200 response', async () => {
      const mockResponse = { ok: false, status: 503 };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const client = new OllamaClient();
      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });
});
