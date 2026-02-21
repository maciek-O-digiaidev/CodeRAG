import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';
import { handleExplain, explainInputSchema } from './explain.js';
import type {
  HybridSearch,
  ContextExpander,
  SearchResult,
  ExpandedContext,
} from '@coderag/core';
import { EmbedError } from '@coderag/core';

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

function parseResponse(response: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(response.content[0]!.text);
}

// --- Input Validation Tests ---

describe('explainInputSchema', () => {
  it('should accept valid input with name', () => {
    const result = explainInputSchema.safeParse({ name: 'hello' });
    expect(result.success).toBe(true);
  });

  it('should accept valid input with file_path', () => {
    const result = explainInputSchema.safeParse({ file_path: 'src/utils/hello.ts' });
    expect(result.success).toBe(true);
  });

  it('should reject input with neither file_path nor name', () => {
    const result = explainInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject file_path with path traversal', () => {
    const result = explainInputSchema.safeParse({ file_path: '../../etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('should apply default detail_level of detailed', () => {
    const result = explainInputSchema.parse({ name: 'hello' });
    expect(result.detail_level).toBe('detailed');
  });

  it('should accept brief detail_level', () => {
    const result = explainInputSchema.parse({ name: 'hello', detail_level: 'brief' });
    expect(result.detail_level).toBe('brief');
  });

  it('should reject invalid detail_level', () => {
    const result = explainInputSchema.safeParse({ name: 'hello', detail_level: 'verbose' });
    expect(result.success).toBe(false);
  });

  it('should accept both file_path and name together', () => {
    const result = explainInputSchema.safeParse({ file_path: 'src/hello.ts', name: 'hello' });
    expect(result.success).toBe(true);
  });
});

// --- Handler Tests ---

describe('handleExplain', () => {
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

  it('should return validation error when both file_path and name are missing', async () => {
    const response = await handleExplain({}, mockHybridSearch, mockContextExpander);
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should return validation error for file_path with path traversal', async () => {
    const response = await handleExplain(
      { file_path: '../../../etc/passwd' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string };

    expect(parsed.error).toBe('Invalid input');
  });

  it('should return graceful message when services are null', async () => {
    const response = await handleExplain({ name: 'hello' }, null, null);
    const parsed = parseResponse(response) as {
      explanation: { chunks: unknown[] };
      chunks_found: number;
      message: string;
    };

    expect(parsed.chunks_found).toBe(0);
    expect(parsed.explanation.chunks).toEqual([]);
    expect(parsed.message).toContain('not initialized');
  });

  it('should search by name and return matching chunks', async () => {
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const expandedContext: ExpandedContext = {
      primaryResults: results,
      relatedChunks: [],
      graphExcerpt: { nodes: [], edges: [] },
    };
    vi.mocked(mockContextExpander.expand).mockReturnValue(expandedContext);

    const response = await handleExplain(
      { name: 'hello' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as {
      explanation: { chunks: Array<{ name: string; code: string; nl_summary: string }> };
      chunks_found: number;
    };

    expect(mockHybridSearch.search).toHaveBeenCalledWith('hello', { topK: 5 });
    expect(parsed.chunks_found).toBe(1);
    expect(parsed.explanation.chunks[0]!.name).toBe('hello');
    expect(parsed.explanation.chunks[0]!.nl_summary).toBe('A greeting function');
    expect(parsed.explanation.chunks[0]!.code).toBe('function hello() {}');
  });

  it('should search by file_path and return matching chunks', async () => {
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const expandedContext: ExpandedContext = {
      primaryResults: results,
      relatedChunks: [],
      graphExcerpt: { nodes: [], edges: [] },
    };
    vi.mocked(mockContextExpander.expand).mockReturnValue(expandedContext);

    const response = await handleExplain(
      { file_path: 'src/utils/hello.ts' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as {
      explanation: { chunks: Array<{ file_path: string }> };
      chunks_found: number;
    };

    expect(mockHybridSearch.search).toHaveBeenCalledWith('src/utils/hello.ts', { topK: 20 });
    expect(parsed.chunks_found).toBe(1);
    expect(parsed.explanation.chunks[0]!.file_path).toBe('src/utils/hello.ts');
  });

  it('should return brief output without code or related_symbols', async () => {
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleExplain(
      { name: 'hello', detail_level: 'brief' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as {
      explanation: {
        chunks: Array<{ nl_summary: string; code?: string }>;
        detail_level: string;
        related_symbols?: string[];
      };
    };

    expect(parsed.explanation.detail_level).toBe('brief');
    expect(parsed.explanation.chunks[0]!.nl_summary).toBe('A greeting function');
    expect(parsed.explanation.chunks[0]!.code).toBeUndefined();
    expect(parsed.explanation.related_symbols).toBeUndefined();
  });

  it('should return detailed output with code and related_symbols', async () => {
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const depResult = makeSearchResult({
      chunkId: 'dep-1',
      metadata: {
        chunkType: 'function',
        name: 'greet',
        declarations: [],
        imports: [],
        exports: [],
      },
      chunk: {
        id: 'dep-1',
        content: 'function greet() {}',
        nlSummary: 'A greet helper',
        filePath: 'src/utils/greet.ts',
        startLine: 1,
        endLine: 2,
        language: 'typescript',
        metadata: {
          chunkType: 'function',
          name: 'greet',
          declarations: [],
          imports: [],
          exports: [],
        },
      },
    });

    const expandedContext: ExpandedContext = {
      primaryResults: results,
      relatedChunks: [
        {
          chunk: depResult,
          relationship: 'imports',
          distance: 1,
        },
      ],
      graphExcerpt: { nodes: [], edges: [] },
    };
    vi.mocked(mockContextExpander.expand).mockReturnValue(expandedContext);

    const response = await handleExplain(
      { name: 'hello', detail_level: 'detailed' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as {
      explanation: {
        chunks: Array<{ code: string }>;
        detail_level: string;
        related_symbols: string[];
      };
    };

    expect(parsed.explanation.detail_level).toBe('detailed');
    expect(parsed.explanation.chunks[0]!.code).toBe('function hello() {}');
    expect(parsed.explanation.related_symbols).toContain('greet');
  });

  it('should handle search API errors gracefully', async () => {
    vi.mocked(mockHybridSearch.search).mockResolvedValue(
      err(new EmbedError('Connection refused')),
    );

    const response = await handleExplain(
      { name: 'hello' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Search failed');
    expect(parsed.message).toContain('Connection refused');
  });

  it('should handle thrown exceptions', async () => {
    vi.mocked(mockHybridSearch.search).mockRejectedValue(new Error('Unexpected'));

    const response = await handleExplain(
      { name: 'hello' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Explain failed');
    expect(parsed.message).toBe('Unexpected');
  });

  it('should return empty explanation when no chunks match name', async () => {
    const results = [makeSearchResult({
      metadata: {
        chunkType: 'function',
        name: 'other',
        declarations: [],
        imports: [],
        exports: [],
      },
    })];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleExplain(
      { name: 'hello' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as {
      chunks_found: number;
      message: string;
    };

    expect(parsed.chunks_found).toBe(0);
    expect(parsed.message).toContain('No chunks found matching name: hello');
  });

  it('should return empty explanation when no chunks match file_path', async () => {
    const results = [makeSearchResult()]; // filePath is 'src/utils/hello.ts'
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleExplain(
      { file_path: 'src/other.ts' },
      mockHybridSearch,
      mockContextExpander,
    );
    const parsed = parseResponse(response) as {
      chunks_found: number;
      message: string;
    };

    expect(parsed.chunks_found).toBe(0);
    expect(parsed.message).toContain('No chunks found for file: src/other.ts');
  });

  it('should work without context expander in detailed mode', async () => {
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const response = await handleExplain(
      { name: 'hello', detail_level: 'detailed' },
      mockHybridSearch,
      null, // no context expander
    );
    const parsed = parseResponse(response) as {
      explanation: {
        chunks: Array<{ code: string }>;
        related_symbols?: string[];
      };
      chunks_found: number;
    };

    expect(parsed.chunks_found).toBe(1);
    expect(parsed.explanation.chunks[0]!.code).toBe('function hello() {}');
    // No related_symbols since context expander is null
    expect(parsed.explanation.related_symbols).toBeUndefined();
  });
});
