import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from 'neverthrow';
import { handleDocs, docsInputSchema } from './docs.js';
import type { HybridSearch, SearchResult, ReRanker } from '@code-rag/core';
import { EmbedError } from '@code-rag/core';

// --- Helpers ---

function makeDocResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: 'doc-chunk-1',
    content: '## Getting Started\n\nInstall with `pnpm install`.',
    nlSummary: 'Instructions for getting started with the project',
    score: 0.9,
    method: 'hybrid',
    metadata: {
      chunkType: 'doc',
      name: 'Getting Started',
      declarations: [],
      imports: [],
      exports: [],
      docTitle: 'Getting Started',
    },
    chunk: {
      id: 'doc-chunk-1',
      content: '## Getting Started\n\nInstall with `pnpm install`.',
      nlSummary: 'Instructions for getting started with the project',
      filePath: 'docs/README.md',
      startLine: 1,
      endLine: 5,
      language: 'markdown',
      metadata: {
        chunkType: 'doc',
        name: 'Getting Started',
        declarations: [],
        imports: [],
        exports: [],
        docTitle: 'Getting Started',
      },
    },
    ...overrides,
  };
}

function makeConfluenceResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: 'confluence-chunk-1',
    content: '# API Reference\n\nEndpoint documentation.',
    nlSummary: 'API reference documentation from Confluence',
    score: 0.85,
    method: 'hybrid',
    metadata: {
      chunkType: 'doc',
      name: 'API Reference',
      declarations: [],
      imports: [],
      exports: [],
      docTitle: 'API Reference',
    },
    chunk: {
      id: 'confluence-chunk-1',
      content: '# API Reference\n\nEndpoint documentation.',
      nlSummary: 'API reference documentation from Confluence',
      filePath: 'confluence://spaces/DEV/pages/12345',
      startLine: 1,
      endLine: 3,
      language: 'markdown',
      metadata: {
        chunkType: 'doc',
        name: 'API Reference',
        declarations: [],
        imports: [],
        exports: [],
        docTitle: 'API Reference',
      },
    },
    ...overrides,
  };
}

function makeCodeResult(): SearchResult {
  return {
    chunkId: 'code-chunk-1',
    content: 'function hello() {}',
    nlSummary: 'A greeting function',
    score: 0.8,
    method: 'hybrid',
    metadata: {
      chunkType: 'function',
      name: 'hello',
      declarations: [],
      imports: [],
      exports: [],
    },
    chunk: {
      id: 'code-chunk-1',
      content: 'function hello() {}',
      nlSummary: 'A greeting function',
      filePath: 'src/hello.ts',
      startLine: 1,
      endLine: 1,
      language: 'typescript',
      metadata: {
        chunkType: 'function',
        name: 'hello',
        declarations: [],
        imports: [],
        exports: [],
      },
    },
  };
}

function parseResponse(response: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(response.content[0]!.text);
}

// --- Input Schema Validation ---

describe('docsInputSchema', () => {
  it('should accept valid input with just query', () => {
    const result = docsInputSchema.safeParse({ query: 'getting started' });
    expect(result.success).toBe(true);
  });

  it('should reject empty query', () => {
    const result = docsInputSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing query', () => {
    const result = docsInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should apply default source of all', () => {
    const result = docsInputSchema.parse({ query: 'test' });
    expect(result.source).toBe('all');
  });

  it('should accept markdown source', () => {
    const result = docsInputSchema.parse({ query: 'test', source: 'markdown' });
    expect(result.source).toBe('markdown');
  });

  it('should accept confluence source', () => {
    const result = docsInputSchema.parse({ query: 'test', source: 'confluence' });
    expect(result.source).toBe('confluence');
  });

  it('should reject invalid source', () => {
    const result = docsInputSchema.safeParse({ query: 'test', source: 'wiki' });
    expect(result.success).toBe(false);
  });

  it('should reject file_path with path traversal', () => {
    const result = docsInputSchema.safeParse({ query: 'test', file_path: '../../etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('should accept valid file_path', () => {
    const result = docsInputSchema.safeParse({ query: 'test', file_path: 'docs/guide.md' });
    expect(result.success).toBe(true);
  });

  it('should apply default top_k of 10', () => {
    const result = docsInputSchema.parse({ query: 'test' });
    expect(result.top_k).toBe(10);
  });

  it('should reject top_k greater than 100', () => {
    const result = docsInputSchema.safeParse({ query: 'test', top_k: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject non-positive top_k', () => {
    const result = docsInputSchema.safeParse({ query: 'test', top_k: 0 });
    expect(result.success).toBe(false);
  });
});

// --- Handler Tests ---

describe('handleDocs', () => {
  let mockHybridSearch: HybridSearch;
  let mockReranker: ReRanker;

  beforeEach(() => {
    mockHybridSearch = {
      search: vi.fn(),
    } as unknown as HybridSearch;

    mockReranker = {
      rerank: vi.fn(),
    } as unknown as ReRanker;
  });

  it('should return validation error for invalid input', async () => {
    const response = await handleDocs({}, mockHybridSearch, mockReranker);
    const parsed = parseResponse(response) as { error: string };
    expect(parsed.error).toBe('Invalid input');
  });

  it('should return graceful message when search engine is null', async () => {
    const response = await handleDocs({ query: 'test' }, null, null);
    const parsed = parseResponse(response) as { results: unknown[]; message: string };
    expect(parsed.results).toEqual([]);
    expect(parsed.message).toContain('not initialized');
  });

  it('should search and return only doc type chunks', async () => {
    const docResult = makeDocResult();
    const codeResult = makeCodeResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([docResult, codeResult]));

    const response = await handleDocs(
      { query: 'getting started' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { results: Array<{ file_path: string }> };

    expect(mockHybridSearch.search).toHaveBeenCalledWith('getting started', { topK: 10 });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]!.file_path).toBe('docs/README.md');
  });

  it('should filter by markdown source', async () => {
    const mdResult = makeDocResult();
    const confluenceResult = makeConfluenceResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([mdResult, confluenceResult]));

    const response = await handleDocs(
      { query: 'docs', source: 'markdown' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { results: Array<{ source: string }> };

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]!.source).toBe('markdown');
  });

  it('should filter by confluence source', async () => {
    const mdResult = makeDocResult();
    const confluenceResult = makeConfluenceResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([mdResult, confluenceResult]));

    const response = await handleDocs(
      { query: 'api', source: 'confluence' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { results: Array<{ source: string }> };

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]!.source).toBe('confluence');
  });

  it('should return all sources when source is all', async () => {
    const mdResult = makeDocResult();
    const confluenceResult = makeConfluenceResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([mdResult, confluenceResult]));

    const response = await handleDocs(
      { query: 'docs', source: 'all' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { results: Array<{ source: string }> };

    expect(parsed.results).toHaveLength(2);
  });

  it('should filter by file_path', async () => {
    const guideResult = makeDocResult({
      chunk: {
        id: 'doc-guide',
        content: 'Guide content',
        nlSummary: 'A guide',
        filePath: 'docs/guide.md',
        startLine: 1,
        endLine: 3,
        language: 'markdown',
        metadata: {
          chunkType: 'doc',
          name: 'Guide',
          declarations: [],
          imports: [],
          exports: [],
        },
      },
    });
    const readmeResult = makeDocResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([guideResult, readmeResult]));

    const response = await handleDocs(
      { query: 'docs', file_path: 'guide.md' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { results: Array<{ file_path: string }> };

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]!.file_path).toBe('docs/guide.md');
  });

  it('should return empty results when no docs match', async () => {
    const codeResult = makeCodeResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([codeResult]));

    const response = await handleDocs(
      { query: 'test' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { results: unknown[] };

    expect(parsed.results).toHaveLength(0);
  });

  it('should handle search API errors gracefully', async () => {
    vi.mocked(mockHybridSearch.search).mockResolvedValue(
      err(new EmbedError('Connection refused')),
    );

    const response = await handleDocs(
      { query: 'test' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Search failed');
    expect(parsed.message).toContain('Connection refused');
  });

  it('should handle thrown exceptions', async () => {
    vi.mocked(mockHybridSearch.search).mockRejectedValue(new Error('Unexpected'));

    const response = await handleDocs(
      { query: 'test' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { error: string; message: string };

    expect(parsed.error).toBe('Docs search failed');
    expect(parsed.message).toBe('Unexpected');
  });

  it('should format doc results with heading and source', async () => {
    const docResult = makeDocResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([docResult]));

    const response = await handleDocs(
      { query: 'getting started' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as {
      results: Array<{
        file_path: string;
        heading: string;
        content: string;
        nl_summary: string;
        score: number;
        source: string;
      }>;
    };

    expect(parsed.results[0]!.file_path).toBe('docs/README.md');
    expect(parsed.results[0]!.heading).toBe('Getting Started');
    expect(parsed.results[0]!.content).toContain('pnpm install');
    expect(parsed.results[0]!.nl_summary).toContain('getting started');
    expect(parsed.results[0]!.score).toBe(0.9);
    expect(parsed.results[0]!.source).toBe('markdown');
  });

  it('should apply custom top_k', async () => {
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([]));

    await handleDocs(
      { query: 'test', top_k: 5 },
      mockHybridSearch,
      null,
    );

    expect(mockHybridSearch.search).toHaveBeenCalledWith('test', { topK: 5 });
  });

  it('should re-rank results when reranker is available', async () => {
    const docResult1 = makeDocResult({ score: 0.7 });
    const docResult2 = makeDocResult({
      chunkId: 'doc-chunk-2',
      score: 0.9,
      content: '## Advanced\n\nAdvanced usage.',
      metadata: {
        chunkType: 'doc',
        name: 'Advanced',
        declarations: [],
        imports: [],
        exports: [],
        docTitle: 'Advanced',
      },
      chunk: {
        id: 'doc-chunk-2',
        content: '## Advanced\n\nAdvanced usage.',
        nlSummary: 'Advanced usage guide',
        filePath: 'docs/advanced.md',
        startLine: 1,
        endLine: 3,
        language: 'markdown',
        metadata: {
          chunkType: 'doc',
          name: 'Advanced',
          declarations: [],
          imports: [],
          exports: [],
          docTitle: 'Advanced',
        },
      },
    });

    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([docResult1, docResult2]));
    // Reranker reverses order
    vi.mocked(mockReranker.rerank).mockResolvedValue(ok([docResult2, docResult1]));

    const response = await handleDocs(
      { query: 'advanced' },
      mockHybridSearch,
      mockReranker,
    );
    const parsed = parseResponse(response) as { results: Array<{ heading: string }> };

    expect(mockReranker.rerank).toHaveBeenCalled();
    expect(parsed.results[0]!.heading).toBe('Advanced');
  });

  it('should fall back to original results when reranking fails', async () => {
    const docResult = makeDocResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([docResult]));
    vi.mocked(mockReranker.rerank).mockResolvedValue(
      err(new EmbedError('Rerank failed')),
    );

    const response = await handleDocs(
      { query: 'test' },
      mockHybridSearch,
      mockReranker,
    );
    const parsed = parseResponse(response) as { results: Array<{ file_path: string }> };

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]!.file_path).toBe('docs/README.md');
  });

  it('should not invoke reranker when no doc results remain after filtering', async () => {
    const codeResult = makeCodeResult();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([codeResult]));

    await handleDocs(
      { query: 'test' },
      mockHybridSearch,
      mockReranker,
    );

    expect(mockReranker.rerank).not.toHaveBeenCalled();
  });

  it('should use name as heading fallback when docTitle is missing', async () => {
    const docResult = makeDocResult({
      metadata: {
        chunkType: 'doc',
        name: 'Section Name',
        declarations: [],
        imports: [],
        exports: [],
        // No docTitle
      },
    });
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([docResult]));

    const response = await handleDocs(
      { query: 'test' },
      mockHybridSearch,
      null,
    );
    const parsed = parseResponse(response) as { results: Array<{ heading: string }> };

    expect(parsed.results[0]!.heading).toBe('Section Name');
  });
});
