import { describe, it, expect } from 'vitest';
import { createEmbeddingProvider } from './index-cmd.js';
import {
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  type EmbeddingConfig,
} from '@coderag/core';

describe('createEmbeddingProvider', () => {
  it('should return OllamaEmbeddingProvider for provider "ollama"', () => {
    const config: EmbeddingConfig = {
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    };

    const provider = createEmbeddingProvider(config);

    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.dimensions).toBe(768);
  });

  it('should return OllamaEmbeddingProvider for provider "auto"', () => {
    const config: EmbeddingConfig = {
      provider: 'auto',
      model: 'nomic-embed-text',
      dimensions: 768,
    };

    const provider = createEmbeddingProvider(config);

    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it('should return OllamaEmbeddingProvider for unknown provider (backwards compatible)', () => {
    const config: EmbeddingConfig = {
      provider: 'unknown-provider',
      model: 'nomic-embed-text',
      dimensions: 768,
    };

    const provider = createEmbeddingProvider(config);

    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it('should return OpenAICompatibleEmbeddingProvider for provider "openai-compatible"', () => {
    const config: EmbeddingConfig = {
      provider: 'openai-compatible',
      model: 'nomic-embed-text',
      dimensions: 768,
      openaiCompatible: {
        baseUrl: 'http://localhost:1234/v1',
        maxBatchSize: 50,
      },
    };

    const provider = createEmbeddingProvider(config);

    expect(provider).toBeInstanceOf(OpenAICompatibleEmbeddingProvider);
    expect(provider.dimensions).toBe(768);
  });

  it('should use default openaiCompatible values when section is missing', () => {
    const config: EmbeddingConfig = {
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    };

    const provider = createEmbeddingProvider(config);

    expect(provider).toBeInstanceOf(OpenAICompatibleEmbeddingProvider);
    expect(provider.dimensions).toBe(1536);
  });

  it('should pass apiKey to OpenAICompatibleEmbeddingProvider', () => {
    const config: EmbeddingConfig = {
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      openaiCompatible: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-key',
        maxBatchSize: 100,
      },
    };

    const provider = createEmbeddingProvider(config);

    expect(provider).toBeInstanceOf(OpenAICompatibleEmbeddingProvider);
    expect(provider.dimensions).toBe(1536);
  });
});
