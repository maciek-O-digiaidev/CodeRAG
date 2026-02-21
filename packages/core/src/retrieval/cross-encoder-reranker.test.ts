import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrossEncoderReRanker } from './cross-encoder-reranker.js';
import { ReRankerError } from '../types/provider.js';
import type { SearchResult } from '../types/search.js';

// --- Helpers ---

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: 'chunk-1',
    content: 'function hello() {}',
    nlSummary: 'A greeting function',
    score: 0.95,
    method: 'hybrid',
    metadata: {
      chunkType: 'function',
      name: 'hello',
      declarations: [],
      imports: [],
      exports: [],
    },
    chunk: {
      id: 'chunk-1',
      content: 'function hello() {}',
      nlSummary: 'A greeting function',
      filePath: 'src/utils/hello.ts',
      startLine: 1,
      endLine: 3,
      language: 'typescript',
      metadata: {
        chunkType: 'function',
        name: 'hello',
        declarations: [],
        imports: [],
        exports: [],
      },
    },
    ...overrides,
  };
}

function createMockFetch(responses: Array<{ ok: boolean; response?: string; status?: number }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const config = responses[callIndex++];
    if (!config) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });
    }
    if (!config.ok) {
      return Promise.resolve({
        ok: false,
        status: config.status ?? 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: config.response ?? '50' }),
    });
  });
}

// --- Tests ---

describe('CrossEncoderReRanker', () => {
  let reranker: CrossEncoderReRanker;

  beforeEach(() => {
    vi.restoreAllMocks();
    reranker = new CrossEncoderReRanker({
      model: 'qwen2.5-coder:7b',
      topN: 3,
    });
  });

  it('should return ok([]) for empty results array', async () => {
    const result = await reranker.rerank('test query', []);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('should rerank results by Ollama-scored relevance', async () => {
    const results = [
      makeSearchResult({ chunkId: 'chunk-1', content: 'function a() {}' }),
      makeSearchResult({ chunkId: 'chunk-2', content: 'function b() {}' }),
      makeSearchResult({ chunkId: 'chunk-3', content: 'function c() {}' }),
    ];

    // Return different scores: chunk-1 gets 30, chunk-2 gets 90, chunk-3 gets 60
    const mockFetch = createMockFetch([
      { ok: true, response: '30' },
      { ok: true, response: '90' },
      { ok: true, response: '60' },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await reranker.rerank('find function', results);

    expect(result.isOk()).toBe(true);
    const reranked = result._unsafeUnwrap();
    expect(reranked).toHaveLength(3);
    // Sorted by score descending: chunk-2 (90), chunk-3 (60), chunk-1 (30)
    expect(reranked[0]!.chunkId).toBe('chunk-2');
    expect(reranked[1]!.chunkId).toBe('chunk-3');
    expect(reranked[2]!.chunkId).toBe('chunk-1');
  });

  it('should only rerank topN results, remaining appended in original order', async () => {
    const results = [
      makeSearchResult({ chunkId: 'chunk-1', content: 'function a() {}' }),
      makeSearchResult({ chunkId: 'chunk-2', content: 'function b() {}' }),
      makeSearchResult({ chunkId: 'chunk-3', content: 'function c() {}' }),
      makeSearchResult({ chunkId: 'chunk-4', content: 'function d() {}' }),
      makeSearchResult({ chunkId: 'chunk-5', content: 'function e() {}' }),
    ];

    // topN is 3, so only first 3 are reranked
    // chunk-1 gets 20, chunk-2 gets 80, chunk-3 gets 50
    const mockFetch = createMockFetch([
      { ok: true, response: '20' },
      { ok: true, response: '80' },
      { ok: true, response: '50' },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await reranker.rerank('find function', results);

    expect(result.isOk()).toBe(true);
    const reranked = result._unsafeUnwrap();
    expect(reranked).toHaveLength(5);
    // First 3 reranked by score: chunk-2 (80), chunk-3 (50), chunk-1 (20)
    expect(reranked[0]!.chunkId).toBe('chunk-2');
    expect(reranked[1]!.chunkId).toBe('chunk-3');
    expect(reranked[2]!.chunkId).toBe('chunk-1');
    // Remaining in original order
    expect(reranked[3]!.chunkId).toBe('chunk-4');
    expect(reranked[4]!.chunkId).toBe('chunk-5');

    // Only 3 fetch calls should have been made
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should handle non-numeric LLM response (defaults score to 50)', async () => {
    const results = [
      makeSearchResult({ chunkId: 'chunk-1', content: 'function a() {}' }),
      makeSearchResult({ chunkId: 'chunk-2', content: 'function b() {}' }),
    ];

    const mockFetch = createMockFetch([
      { ok: true, response: 'I cannot rate this code' },
      { ok: true, response: '80' },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await reranker.rerank('find function', results);

    expect(result.isOk()).toBe(true);
    const reranked = result._unsafeUnwrap();
    // chunk-2 (80) should come before chunk-1 (default 50)
    expect(reranked[0]!.chunkId).toBe('chunk-2');
    expect(reranked[1]!.chunkId).toBe('chunk-1');
  });

  it('should clamp scores to 0-100 (150 -> 100, -5 -> 0)', async () => {
    const results = [
      makeSearchResult({ chunkId: 'chunk-1', content: 'function a() {}' }),
      makeSearchResult({ chunkId: 'chunk-2', content: 'function b() {}' }),
      makeSearchResult({ chunkId: 'chunk-3', content: 'function c() {}' }),
    ];

    const mockFetch = createMockFetch([
      { ok: true, response: '150' },
      { ok: true, response: '-5' },
      { ok: true, response: '50' },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await reranker.rerank('find function', results);

    expect(result.isOk()).toBe(true);
    const reranked = result._unsafeUnwrap();
    // chunk-1 (150 clamped to 100), chunk-3 (50), chunk-2 (-5 clamped to 0)
    expect(reranked[0]!.chunkId).toBe('chunk-1');
    expect(reranked[1]!.chunkId).toBe('chunk-3');
    expect(reranked[2]!.chunkId).toBe('chunk-2');
  });

  it('should gracefully handle transient fetch error on later results', async () => {
    const rerankerWith5 = new CrossEncoderReRanker({
      model: 'qwen2.5-coder:7b',
      topN: 3,
    });

    const results = [
      makeSearchResult({ chunkId: 'chunk-1', content: 'function a() {}' }),
      makeSearchResult({ chunkId: 'chunk-2', content: 'function b() {}' }),
      makeSearchResult({ chunkId: 'chunk-3', content: 'function c() {}' }),
    ];

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new TypeError('Connection reset'));
      }
      const score = callCount === 1 ? '90' : '30';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ response: score }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await rerankerWith5.rerank('find function', results);

    // Should succeed (not return err) since first call worked
    expect(result.isOk()).toBe(true);
    const reranked = result._unsafeUnwrap();
    expect(reranked).toHaveLength(3);
    // chunk-1 (90), chunk-2 (default 50 from transient error), chunk-3 (30)
    expect(reranked[0]!.chunkId).toBe('chunk-1');
    expect(reranked[1]!.chunkId).toBe('chunk-2');
    expect(reranked[2]!.chunkId).toBe('chunk-3');
  });

  it('should handle Ollama HTTP error for individual result (assigns default score 50)', async () => {
    const results = [
      makeSearchResult({ chunkId: 'chunk-1', content: 'function a() {}' }),
      makeSearchResult({ chunkId: 'chunk-2', content: 'function b() {}' }),
      makeSearchResult({ chunkId: 'chunk-3', content: 'function c() {}' }),
    ];

    // Second request returns HTTP error
    const mockFetch = createMockFetch([
      { ok: true, response: '90' },
      { ok: false, status: 500 },
      { ok: true, response: '30' },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const result = await reranker.rerank('find function', results);

    expect(result.isOk()).toBe(true);
    const reranked = result._unsafeUnwrap();
    // chunk-1 (90), chunk-2 (default 50), chunk-3 (30)
    expect(reranked[0]!.chunkId).toBe('chunk-1');
    expect(reranked[1]!.chunkId).toBe('chunk-2');
    expect(reranked[2]!.chunkId).toBe('chunk-3');
  });

  it('should return err(ReRankerError) when fetch throws (network error)', async () => {
    const results = [
      makeSearchResult({ chunkId: 'chunk-1', content: 'function a() {}' }),
    ];

    const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await reranker.rerank('find function', results);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(ReRankerError);
    expect(error.name).toBe('ReRankerError');
    expect(error.message).toContain('fetch failed');
  });

  it('should send correct prompt format to Ollama', async () => {
    const results = [
      makeSearchResult({
        chunkId: 'chunk-1',
        content: 'function greet() { return "hi"; }',
        metadata: {
          chunkType: 'function',
          name: 'greet',
          declarations: [],
          imports: [],
          exports: [],
        },
      }),
    ];

    const mockFetch = createMockFetch([{ ok: true, response: '75' }]);
    vi.stubGlobal('fetch', mockFetch);

    await reranker.rerank('greeting function', results);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0]!;
    const body = JSON.parse(callArgs[1].body as string) as { prompt: string; model: string; stream: boolean };

    expect(body.prompt).toContain('Rate relevance 0-100');
    expect(body.prompt).toContain('<query>greeting function</query>');
    expect(body.prompt).toContain('<code type="function" name="greet">');
    expect(body.prompt).toContain('function greet() { return "hi"; }');
    expect(body.prompt).toContain('</code>');
    expect(body.prompt).toContain('Score:');
    expect(body.stream).toBe(false);
  });

  it('should use correct model from config', async () => {
    const customReranker = new CrossEncoderReRanker({
      model: 'custom-model:latest',
      topN: 5,
    });

    const results = [makeSearchResult()];
    const mockFetch = createMockFetch([{ ok: true, response: '75' }]);
    vi.stubGlobal('fetch', mockFetch);

    await customReranker.rerank('test', results);

    const callArgs = mockFetch.mock.calls[0]!;
    const body = JSON.parse(callArgs[1].body as string) as { model: string };
    expect(body.model).toBe('custom-model:latest');
  });

  it('should respect timeout via AbortSignal', async () => {
    const timeoutReranker = new CrossEncoderReRanker({
      model: 'qwen2.5-coder:7b',
      topN: 5,
      timeout: 5000,
    });

    const results = [makeSearchResult()];
    const mockFetch = createMockFetch([{ ok: true, response: '75' }]);
    vi.stubGlobal('fetch', mockFetch);

    await timeoutReranker.rerank('test', results);

    const callArgs = mockFetch.mock.calls[0]!;
    const options = callArgs[1] as { signal: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('should use correct base URL', async () => {
    const customReranker = new CrossEncoderReRanker({
      model: 'qwen2.5-coder:7b',
      baseUrl: 'http://custom-host:8080',
      topN: 5,
    });

    const results = [makeSearchResult()];
    const mockFetch = createMockFetch([{ ok: true, response: '75' }]);
    vi.stubGlobal('fetch', mockFetch);

    await customReranker.rerank('test', results);

    const callArgs = mockFetch.mock.calls[0]!;
    expect(callArgs[0]).toBe('http://custom-host:8080/api/generate');
  });
});
