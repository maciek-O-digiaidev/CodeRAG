import { describe, it, expect, vi } from 'vitest';
import { ok, err } from 'neverthrow';
import type { Chunk } from '../types/chunk.js';
import { OllamaClient, OllamaError } from './ollama-client.js';
import { NLEnricher, EnrichmentError } from './nl-enricher.js';

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: 'chunk-1',
    content: 'function add(a: number, b: number): number { return a + b; }',
    nlSummary: '',
    filePath: '/src/math.ts',
    startLine: 1,
    endLine: 1,
    language: 'typescript',
    metadata: {
      chunkType: 'function',
      name: 'add',
      declarations: ['add'],
      imports: [],
      exports: ['add'],
    },
    ...overrides,
  };
}

function createMockClient(
  generateFn: OllamaClient['generate'],
): OllamaClient {
  return { generate: generateFn } as unknown as OllamaClient;
}

describe('NLEnricher', () => {
  describe('enrichChunk', () => {
    it('should add nlSummary to the chunk on success', async () => {
      const mockClient = createMockClient(
        vi.fn().mockResolvedValue(ok('Adds two numbers together.')),
      );
      const enricher = new NLEnricher(mockClient);

      const result = await enricher.enrichChunk(makeChunk());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.nlSummary).toBe('Adds two numbers together.');
        expect(result.value.id).toBe('chunk-1');
        expect(result.value.content).toBe(
          'function add(a: number, b: number): number { return a + b; }',
        );
      }
    });

    it('should trim whitespace from the summary', async () => {
      const mockClient = createMockClient(
        vi.fn().mockResolvedValue(ok('  Adds two numbers.  \n')),
      );
      const enricher = new NLEnricher(mockClient);

      const result = await enricher.enrichChunk(makeChunk());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.nlSummary).toBe('Adds two numbers.');
      }
    });

    it('should build the correct prompt with the chunk language', async () => {
      const generateFn = vi.fn().mockResolvedValue(ok('Summary.'));
      const mockClient = createMockClient(generateFn);
      const enricher = new NLEnricher(mockClient);

      const chunk = makeChunk({ language: 'python' });
      await enricher.enrichChunk(chunk);

      expect(generateFn).toHaveBeenCalledWith(
        expect.stringContaining('Summarize this python code'),
      );
      expect(generateFn).toHaveBeenCalledWith(
        expect.stringContaining(chunk.content),
      );
    });

    it('should return EnrichmentError when Ollama fails', async () => {
      const mockClient = createMockClient(
        vi.fn().mockResolvedValue(err(new OllamaError('Connection refused'))),
      );
      const enricher = new NLEnricher(mockClient);

      const result = await enricher.enrichChunk(makeChunk());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EnrichmentError);
        expect(result.error.message).toContain('chunk-1');
        expect(result.error.message).toContain('Connection refused');
      }
    });
  });

  describe('enrichBatch', () => {
    it('should process all chunks successfully', async () => {
      let callCount = 0;
      const mockClient = createMockClient(
        vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve(ok(`Summary ${callCount}.`));
        }),
      );
      const enricher = new NLEnricher(mockClient);

      const chunks = [
        makeChunk({ id: 'c1' }),
        makeChunk({ id: 'c2' }),
        makeChunk({ id: 'c3' }),
      ];

      const result = await enricher.enrichBatch(chunks);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
        expect(result.value[0]!.nlSummary).toBe('Summary 1.');
        expect(result.value[1]!.nlSummary).toBe('Summary 2.');
        expect(result.value[2]!.nlSummary).toBe('Summary 3.');
      }
    });

    it('should respect concurrency limit', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const mockClient = createMockClient(
        vi.fn().mockImplementation(() => {
          currentConcurrent++;
          if (currentConcurrent > maxConcurrent) {
            maxConcurrent = currentConcurrent;
          }
          return new Promise((resolve) => {
            setTimeout(() => {
              currentConcurrent--;
              resolve(ok('Summary.'));
            }, 10);
          });
        }),
      );
      const enricher = new NLEnricher(mockClient);

      const chunks = Array.from({ length: 6 }, (_, i) =>
        makeChunk({ id: `c${i}` }),
      );

      const result = await enricher.enrichBatch(chunks, 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(6);
      }
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should return ok with empty array when input is empty', async () => {
      const mockClient = createMockClient(vi.fn());
      const enricher = new NLEnricher(mockClient);

      const result = await enricher.enrichBatch([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return EnrichmentError when any chunk fails', async () => {
      let callCount = 0;
      const mockClient = createMockClient(
        vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) {
            return Promise.resolve(
              err(new OllamaError('Model not loaded')),
            );
          }
          return Promise.resolve(ok('Summary.'));
        }),
      );
      const enricher = new NLEnricher(mockClient);

      const chunks = [
        makeChunk({ id: 'c1' }),
        makeChunk({ id: 'c2' }),
        makeChunk({ id: 'c3' }),
      ];

      const result = await enricher.enrichBatch(chunks);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(EnrichmentError);
        expect(result.error.message).toContain('Failed to enrich');
      }
    });
  });
});
