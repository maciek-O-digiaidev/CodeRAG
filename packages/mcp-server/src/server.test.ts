import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';
import { handleSearch, searchInputSchema } from './tools/search.js';
import { handleContext, contextInputSchema } from './tools/context.js';
import { handleStatus } from './tools/status.js';
import type {
  HybridSearch,
  ContextExpander,
  LanceDBStore,
  CodeRAGConfig,
  SearchResult,
  ExpandedContext,
} from '@coderag/core';
import { EmbedError, StoreError } from '@coderag/core';

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

function makeConfig(overrides: Partial<CodeRAGConfig> = {}): CodeRAGConfig {
  return {
    version: '1',
    project: { name: 'test-project', languages: ['typescript'] },
    ingestion: { maxTokensPerChunk: 512, exclude: [] },
    embedding: { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 },
    llm: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    search: { topK: 10, vectorWeight: 0.7, bm25Weight: 0.3 },
    storage: { path: '.coderag' },
    ...overrides,
  };
}

function parseResponse(response: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(response.content[0]!.text);
}

// --- Search Tool Tests ---

describe('handleSearch', () => {
  let mockHybridSearch: HybridSearch;

  beforeEach(() => {
    mockHybridSearch = {
      search: vi.fn(),
    } as unknown as HybridSearch;
  });

  it('should return results for a valid query', async () => {
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleSearch({ query: 'hello function' }, mockHybridSearch);
    const parsed = parseResponse(response) as { results: unknown[] };

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toEqual({
      file_path: 'src/utils/hello.ts',
      chunk_type: 'function',
      name: 'hello',
      content: 'function hello() {}',
      nl_summary: 'A greeting function',
      score: 0.95,
    });
  });

  it('should return validation error for missing query', async () => {
    const response = await handleSearch({}, mockHybridSearch);
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should return validation error for empty query', async () => {
    const response = await handleSearch({ query: '' }, mockHybridSearch);
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should return empty results when search index is not initialized', async () => {
    const response = await handleSearch({ query: 'hello' }, null);
    const parsed = parseResponse(response) as { results: unknown[]; message: string };

    expect(parsed.results).toEqual([]);
    expect(parsed.message).toContain('not initialized');
  });

  it('should handle search API errors gracefully', async () => {
    vi.mocked(mockHybridSearch.search).mockResolvedValue(
      err(new EmbedError('Connection refused')),
    );

    const response = await handleSearch({ query: 'hello' }, mockHybridSearch);
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Search failed');
    expect(parsed.message).toContain('Connection refused');
  });

  it('should filter by language', async () => {
    const results = [
      makeSearchResult(),
      makeSearchResult({
        chunkId: 'chunk-2',
        chunk: {
          id: 'chunk-2',
          content: 'def hello(): pass',
          nlSummary: 'Python greeting',
          filePath: 'src/hello.py',
          startLine: 1,
          endLine: 1,
          language: 'python',
          metadata: {
            chunkType: 'function',
            name: 'hello',
            declarations: [],
            imports: [],
            exports: [],
          },
        },
      }),
    ];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleSearch(
      { query: 'hello', language: 'typescript' },
      mockHybridSearch,
    );
    const parsed = parseResponse(response) as { results: unknown[] };

    expect(parsed.results).toHaveLength(1);
  });

  it('should filter by file_path', async () => {
    const results = [
      makeSearchResult(),
      makeSearchResult({
        chunkId: 'chunk-2',
        chunk: {
          id: 'chunk-2',
          content: 'function other() {}',
          nlSummary: 'Other function',
          filePath: 'src/other/world.ts',
          startLine: 1,
          endLine: 1,
          language: 'typescript',
          metadata: {
            chunkType: 'function',
            name: 'other',
            declarations: [],
            imports: [],
            exports: [],
          },
        },
      }),
    ];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleSearch(
      { query: 'hello', file_path: 'utils' },
      mockHybridSearch,
    );
    const parsed = parseResponse(response) as { results: unknown[] };

    expect(parsed.results).toHaveLength(1);
  });

  it('should filter by chunk_type', async () => {
    const results = [
      makeSearchResult(),
      makeSearchResult({
        chunkId: 'chunk-2',
        metadata: {
          chunkType: 'class',
          name: 'MyClass',
          declarations: [],
          imports: [],
          exports: [],
        },
      }),
    ];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleSearch(
      { query: 'hello', chunk_type: 'function' },
      mockHybridSearch,
    );
    const parsed = parseResponse(response) as { results: unknown[] };

    expect(parsed.results).toHaveLength(1);
  });

  it('should use default top_k of 10', async () => {
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([]));

    await handleSearch({ query: 'hello' }, mockHybridSearch);

    expect(mockHybridSearch.search).toHaveBeenCalledWith('hello', { topK: 10 });
  });

  it('should use custom top_k', async () => {
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([]));

    await handleSearch({ query: 'hello', top_k: 5 }, mockHybridSearch);

    expect(mockHybridSearch.search).toHaveBeenCalledWith('hello', { topK: 5 });
  });

  it('should handle thrown exceptions', async () => {
    vi.mocked(mockHybridSearch.search).mockRejectedValue(new Error('Unexpected'));

    const response = await handleSearch({ query: 'hello' }, mockHybridSearch);
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Search failed');
    expect(parsed.message).toBe('Unexpected');
  });

  it('should reject top_k above 100', async () => {
    const response = await handleSearch({ query: 'hello', top_k: 200 }, mockHybridSearch);
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should reject file_path with path traversal', async () => {
    const response = await handleSearch(
      { query: 'hello', file_path: '../../etc/passwd' },
      mockHybridSearch,
    );
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });
});

// --- Context Tool Tests ---

describe('handleContext', () => {
  let mockHybridSearch: HybridSearch;
  let mockContextExpander: ContextExpander;

  beforeEach(() => {
    mockHybridSearch = {
      search: vi.fn(),
    } as unknown as HybridSearch;

    mockContextExpander = {
      expand: vi.fn(),
    } as unknown as ContextExpander;
  });

  it('should return validation error for missing file_path', async () => {
    const response = await handleContext(
      {},
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should return validation error for empty file_path', async () => {
    const response = await handleContext(
      { file_path: '' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should return degraded message when services are not initialized', async () => {
    const response = await handleContext(
      { file_path: 'src/index.ts' },
      null,
      null,
    );
    const parsed = parseResponse(response) as { context: string; message: string };

    expect(parsed.context).toBe('');
    expect(parsed.message).toContain('not initialized');
  });

  it('should assemble context for a valid file path', async () => {
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const expandedContext: ExpandedContext = {
      primaryResults: results,
      relatedChunks: [],
      graphExcerpt: { nodes: [], edges: [] },
    };
    vi.mocked(mockContextExpander.expand).mockReturnValue(expandedContext);

    const response = await handleContext(
      { file_path: 'src/utils/hello.ts' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as {
      context: string;
      token_count: number;
      truncated: boolean;
      primary_chunks: number;
    };

    expect(parsed.context).toContain('hello');
    expect(parsed.primary_chunks).toBe(1);
    expect(typeof parsed.token_count).toBe('number');
    expect(typeof parsed.truncated).toBe('boolean');
  });

  it('should return empty context when no chunks match file_path', async () => {
    const results = [makeSearchResult()]; // filePath is 'src/utils/hello.ts'
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleContext(
      { file_path: 'src/other.ts' }, // won't match
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { context: string; message: string };

    expect(parsed.context).toBe('');
    expect(parsed.message).toContain('No chunks found');
  });

  it('should handle search failures', async () => {
    vi.mocked(mockHybridSearch.search).mockResolvedValue(
      err(new EmbedError('Embedding service unavailable')),
    );

    const response = await handleContext(
      { file_path: 'src/index.ts' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Search failed');
    expect(parsed.message).toContain('Embedding service unavailable');
  });

  it('should filter out test files when include_tests is false', async () => {
    const results = [
      makeSearchResult(),
      makeSearchResult({
        chunkId: 'chunk-test',
        chunk: {
          id: 'chunk-test',
          content: 'describe("hello")',
          nlSummary: 'Test for hello',
          filePath: 'src/utils/hello.test.ts',
          startLine: 1,
          endLine: 5,
          language: 'typescript',
          metadata: {
            chunkType: 'function',
            name: 'describe',
            declarations: [],
            imports: [],
            exports: [],
          },
        },
      }),
    ];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const expandedContext: ExpandedContext = {
      primaryResults: [results[0]!],
      relatedChunks: [],
      graphExcerpt: { nodes: [], edges: [] },
    };
    vi.mocked(mockContextExpander.expand).mockReturnValue(expandedContext);

    const response = await handleContext(
      { file_path: 'src/utils/hello', include_tests: false },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { primary_chunks: number };

    // Only the non-test chunk should be passed to expander
    expect(mockContextExpander.expand).toHaveBeenCalledWith([results[0]]);
    expect(parsed.primary_chunks).toBe(1);
  });

  it('should filter out interfaces when include_interfaces is false', async () => {
    const results = [
      makeSearchResult(),
      makeSearchResult({
        chunkId: 'chunk-iface',
        metadata: {
          chunkType: 'interface',
          name: 'HelloInterface',
          declarations: [],
          imports: [],
          exports: [],
        },
        chunk: {
          id: 'chunk-iface',
          content: 'interface HelloInterface {}',
          nlSummary: 'Interface for hello',
          filePath: 'src/utils/hello.ts',
          startLine: 5,
          endLine: 10,
          language: 'typescript',
          metadata: {
            chunkType: 'interface',
            name: 'HelloInterface',
            declarations: [],
            imports: [],
            exports: [],
          },
        },
      }),
    ];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const expandedContext: ExpandedContext = {
      primaryResults: [results[0]!],
      relatedChunks: [],
      graphExcerpt: { nodes: [], edges: [] },
    };
    vi.mocked(mockContextExpander.expand).mockReturnValue(expandedContext);

    const response = await handleContext(
      { file_path: 'src/utils/hello', include_interfaces: false },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { primary_chunks: number };

    expect(mockContextExpander.expand).toHaveBeenCalledWith([results[0]]);
    expect(parsed.primary_chunks).toBe(1);
  });

  it('should handle thrown exceptions', async () => {
    vi.mocked(mockHybridSearch.search).mockRejectedValue(new Error('Boom'));

    const response = await handleContext(
      { file_path: 'src/index.ts' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Context assembly failed');
    expect(parsed.message).toBe('Boom');
  });

  it('should reject file_path with path traversal', async () => {
    const response = await handleContext(
      { file_path: '../../etc/passwd' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should reject max_tokens above 128000', async () => {
    const response = await handleContext(
      { file_path: 'src/index.ts', max_tokens: 200000 },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });
});

// --- Status Tool Tests ---

describe('handleStatus', () => {
  let mockStore: LanceDBStore;

  beforeEach(() => {
    mockStore = {
      count: vi.fn(),
    } as unknown as LanceDBStore;
  });

  it('should return not_initialized when store is null', async () => {
    const response = await handleStatus(null, null);
    const parsed = parseResponse(response) as { health: string; total_chunks: number };

    expect(parsed.health).toBe('not_initialized');
    expect(parsed.total_chunks).toBe(0);
    expect(parsed).toHaveProperty('model', 'unknown');
  });

  it('should return ok health when chunks exist', async () => {
    vi.mocked(mockStore.count).mockResolvedValue(ok(42));
    const config = makeConfig();

    const response = await handleStatus(mockStore, config);
    const parsed = parseResponse(response) as {
      health: string;
      total_chunks: number;
      model: string;
      languages: string[];
    };

    expect(parsed.health).toBe('ok');
    expect(parsed.total_chunks).toBe(42);
    expect(parsed.model).toBe('nomic-embed-text');
    expect(parsed.languages).toEqual(['typescript']);
  });

  it('should return degraded health when store is empty', async () => {
    vi.mocked(mockStore.count).mockResolvedValue(ok(0));
    const config = makeConfig();

    const response = await handleStatus(mockStore, config);
    const parsed = parseResponse(response) as { health: string; total_chunks: number };

    expect(parsed.health).toBe('degraded');
    expect(parsed.total_chunks).toBe(0);
  });

  it('should return degraded health when count fails', async () => {
    vi.mocked(mockStore.count).mockResolvedValue(
      err(new StoreError('DB connection lost')),
    );
    const config = makeConfig();

    const response = await handleStatus(mockStore, config);
    const parsed = parseResponse(response) as { health: string };

    expect(parsed.health).toBe('degraded');
  });

  it('should handle thrown exceptions', async () => {
    vi.mocked(mockStore.count).mockRejectedValue(new Error('Fatal'));

    const response = await handleStatus(mockStore, makeConfig());
    const parsed = parseResponse(response) as { error: string; health: string };

    expect(parsed.error).toBe('Status check failed');
    expect(parsed.health).toBe('degraded');
  });

  it('should return auto for languages when config has auto', async () => {
    vi.mocked(mockStore.count).mockResolvedValue(ok(10));
    const config = makeConfig({
      project: { name: 'test', languages: 'auto' },
    });

    const response = await handleStatus(mockStore, config);
    const parsed = parseResponse(response) as { languages: string };

    expect(parsed.languages).toBe('auto');
  });
});

// --- Tool Registration Tests ---

describe('tool definitions', () => {
  it('coderag_search inputSchema has required query field', () => {
    const valid = searchInputSchema.safeParse({ query: 'test' });
    expect(valid.success).toBe(true);

    const invalid = searchInputSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });

  it('coderag_context inputSchema has required file_path field', () => {
    const valid = contextInputSchema.safeParse({ file_path: 'src/index.ts' });
    expect(valid.success).toBe(true);

    const invalid = contextInputSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });

  it('coderag_search inputSchema validates top_k as positive integer', () => {
    const valid = searchInputSchema.safeParse({ query: 'test', top_k: 5 });
    expect(valid.success).toBe(true);

    const invalidNegative = searchInputSchema.safeParse({ query: 'test', top_k: -1 });
    expect(invalidNegative.success).toBe(false);

    const invalidFloat = searchInputSchema.safeParse({ query: 'test', top_k: 1.5 });
    expect(invalidFloat.success).toBe(false);
  });

  it('coderag_search inputSchema rejects top_k above 100', () => {
    const at100 = searchInputSchema.safeParse({ query: 'test', top_k: 100 });
    expect(at100.success).toBe(true);

    const above100 = searchInputSchema.safeParse({ query: 'test', top_k: 101 });
    expect(above100.success).toBe(false);
  });

  it('coderag_search inputSchema rejects file_path with path traversal', () => {
    const valid = searchInputSchema.safeParse({ query: 'test', file_path: 'src/utils' });
    expect(valid.success).toBe(true);

    const traversal = searchInputSchema.safeParse({ query: 'test', file_path: '../etc/passwd' });
    expect(traversal.success).toBe(false);

    const midTraversal = searchInputSchema.safeParse({ query: 'test', file_path: 'src/../../secret' });
    expect(midTraversal.success).toBe(false);
  });

  it('coderag_context inputSchema validates max_tokens as positive integer', () => {
    const valid = contextInputSchema.safeParse({
      file_path: 'src/index.ts',
      max_tokens: 4000,
    });
    expect(valid.success).toBe(true);

    const invalidNegative = contextInputSchema.safeParse({
      file_path: 'src/index.ts',
      max_tokens: -100,
    });
    expect(invalidNegative.success).toBe(false);
  });

  it('coderag_context inputSchema rejects max_tokens above 128000', () => {
    const at128k = contextInputSchema.safeParse({
      file_path: 'src/index.ts',
      max_tokens: 128000,
    });
    expect(at128k.success).toBe(true);

    const above128k = contextInputSchema.safeParse({
      file_path: 'src/index.ts',
      max_tokens: 128001,
    });
    expect(above128k.success).toBe(false);
  });

  it('coderag_context inputSchema rejects file_path with path traversal', () => {
    const valid = contextInputSchema.safeParse({ file_path: 'src/index.ts' });
    expect(valid.success).toBe(true);

    const traversal = contextInputSchema.safeParse({ file_path: '../etc/passwd' });
    expect(traversal.success).toBe(false);

    const midTraversal = contextInputSchema.safeParse({ file_path: 'src/../../secret' });
    expect(midTraversal.success).toBe(false);
  });

  it('coderag_context inputSchema applies defaults', () => {
    const result = contextInputSchema.parse({ file_path: 'src/index.ts' });
    expect(result.include_tests).toBe(true);
    expect(result.include_interfaces).toBe(true);
    expect(result.max_tokens).toBe(8000);
  });

  it('coderag_search inputSchema applies default top_k', () => {
    const result = searchInputSchema.parse({ query: 'test' });
    expect(result.top_k).toBe(10);
  });
});

// --- CodeRAGServer Tests ---

describe('CodeRAGServer', () => {
  it('should export MCP_SERVER_VERSION', async () => {
    const mod = await import('./server.js');
    expect(mod.MCP_SERVER_VERSION).toBe('0.1.0');
  });

  it('should create a server instance', async () => {
    const { CodeRAGServer } = await import('./server.js');
    const server = new CodeRAGServer({ rootDir: '/tmp/test' });
    expect(server).toBeDefined();
    expect(server.getServer()).toBeDefined();
  });
});
