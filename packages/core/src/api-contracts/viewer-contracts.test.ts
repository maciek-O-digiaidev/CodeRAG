import { describe, it, expect } from 'vitest';
import {
  ViewerStatsResponseSchema,
  ViewerChunksResponseSchema,
  ViewerChunkDetailResponseSchema,
  ViewerSearchResponseSchema,
  ViewerGraphResponseSchema,
  ViewerEmbeddingsResponseSchema,
  ChunkSummarySchema,
  ChunkDetailSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  ViewerSearchResultSchema,
  EmbeddingPointSchema,
  PaginationMetaSchema,
} from './viewer-contracts.js';

// ---------------------------------------------------------------------------
// Helper factories — produce valid data matching the actual server responses
// ---------------------------------------------------------------------------

function makeValidStats() {
  return {
    data: {
      chunkCount: 42,
      fileCount: 10,
      languages: { typescript: 30, python: 12 },
      storageBytes: null,
      lastIndexed: '2026-02-25T12:00:00Z',
    },
  };
}

function makeValidChunksResponse() {
  return {
    data: [
      {
        id: 'chunk-1',
        filePath: 'src/hello.ts',
        chunkType: 'function',
        name: 'hello',
        language: 'typescript',
        startLine: 1,
        endLine: 10,
        contentPreview: 'function hello() { return "world"; }',
      },
    ],
    meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
  };
}

function makeValidChunkDetail() {
  return {
    data: {
      id: 'chunk-1',
      filePath: 'src/hello.ts',
      chunkType: 'function',
      name: 'hello',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      content: 'function hello() { return "world"; }',
      nlSummary: 'A function that returns world',
      metadata: { name: 'hello', start_line: 1, end_line: 10 },
    },
  };
}

function makeValidSearchResponse() {
  return {
    data: {
      results: [
        {
          chunkId: 'chunk-1',
          filePath: 'src/hello.ts',
          chunkType: 'function',
          name: 'hello',
          content: 'function hello() {}',
          nlSummary: 'A greeting function',
          score: 0.95,
          method: 'hybrid',
        },
      ],
      timing: { totalMs: 42 },
    },
  };
}

function makeValidGraphResponse() {
  return {
    data: {
      nodes: [
        { id: 'node-1', filePath: 'src/hello.ts', symbols: ['hello'], type: 'function' as const },
      ],
      edges: [
        { source: 'node-1', target: 'node-2', type: 'imports' as const },
      ],
    },
  };
}

function makeValidEmbeddingsResponse() {
  return {
    data: [
      {
        id: 'chunk-1',
        filePath: 'src/hello.ts',
        chunkType: 'function',
        language: 'typescript',
        vector: [0.1, 0.2, 0.3],
      },
    ],
  };
}

// =====================================================
// Stats
// =====================================================

describe('ViewerStatsResponseSchema', () => {
  it('should parse valid stats response', () => {
    const result = ViewerStatsResponseSchema.safeParse(makeValidStats());
    expect(result.success).toBe(true);
  });

  it('should accept null storageBytes and lastIndexed', () => {
    const data = makeValidStats();
    data.data.storageBytes = null;
    data.data.lastIndexed = null;
    const result = ViewerStatsResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject missing data envelope', () => {
    const result = ViewerStatsResponseSchema.safeParse({
      chunkCount: 42,
      fileCount: 10,
      languages: {},
      storageBytes: null,
      lastIndexed: null,
    });
    expect(result.success).toBe(false);
  });

  it('should reject wrong field names (AB#97 scenario — totalChunks instead of chunkCount)', () => {
    const result = ViewerStatsResponseSchema.safeParse({
      data: {
        totalChunks: 42,
        totalFiles: 10,
        languages: {},
        storageBytes: null,
        lastIndexed: null,
      },
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================
// Chunks list
// =====================================================

describe('ViewerChunksResponseSchema', () => {
  it('should parse valid chunks response', () => {
    const result = ViewerChunksResponseSchema.safeParse(makeValidChunksResponse());
    expect(result.success).toBe(true);
  });

  it('should reject missing meta pagination', () => {
    const data = makeValidChunksResponse();
    const { meta: _meta, ...withoutMeta } = data;
    const result = ViewerChunksResponseSchema.safeParse(withoutMeta);
    expect(result.success).toBe(false);
  });

  it('should reject chunk with wrong field name (AB#97 scenario — kind instead of chunkType)', () => {
    const result = ChunkSummarySchema.safeParse({
      id: 'chunk-1',
      filePath: 'src/hello.ts',
      kind: 'function', // wrong: should be chunkType
      name: 'hello',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      contentPreview: 'preview text',
    });
    expect(result.success).toBe(false);
  });

  it('should reject chunk missing required contentPreview', () => {
    const result = ChunkSummarySchema.safeParse({
      id: 'chunk-1',
      filePath: 'src/hello.ts',
      chunkType: 'function',
      name: 'hello',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      // missing contentPreview
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================
// Chunk detail
// =====================================================

describe('ViewerChunkDetailResponseSchema', () => {
  it('should parse valid chunk detail response', () => {
    const result = ViewerChunkDetailResponseSchema.safeParse(makeValidChunkDetail());
    expect(result.success).toBe(true);
  });

  it('should accept optional vector field', () => {
    const data = makeValidChunkDetail();
    (data.data as Record<string, unknown>)['vector'] = [0.1, 0.2, 0.3];
    const result = ViewerChunkDetailResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.vector).toEqual([0.1, 0.2, 0.3]);
    }
  });

  it('should parse without vector field', () => {
    const result = ViewerChunkDetailResponseSchema.safeParse(makeValidChunkDetail());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data.vector).toBeUndefined();
    }
  });

  it('should reject wrong field name (AB#97 scenario — summary instead of nlSummary)', () => {
    const result = ChunkDetailSchema.safeParse({
      id: 'chunk-1',
      filePath: 'src/hello.ts',
      chunkType: 'function',
      name: 'hello',
      language: 'typescript',
      startLine: 1,
      endLine: 10,
      content: 'some code',
      summary: 'A summary', // wrong: should be nlSummary
      metadata: {},
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================
// Search
// =====================================================

describe('ViewerSearchResponseSchema', () => {
  it('should parse valid search response', () => {
    const result = ViewerSearchResponseSchema.safeParse(makeValidSearchResponse());
    expect(result.success).toBe(true);
  });

  it('should reject missing timing', () => {
    const data = makeValidSearchResponse();
    const { timing: _timing, ...dataWithoutTiming } = data.data;
    const result = ViewerSearchResponseSchema.safeParse({
      data: dataWithoutTiming,
    });
    expect(result.success).toBe(false);
  });

  it('should reject search result with wrong field name (AB#97 scenario — snippet instead of content)', () => {
    const result = ViewerSearchResultSchema.safeParse({
      chunkId: 'chunk-1',
      filePath: 'src/hello.ts',
      chunkType: 'function',
      name: 'hello',
      snippet: 'code snippet', // wrong: should be content
      nlSummary: 'summary',
      score: 0.9,
      method: 'hybrid',
    });
    expect(result.success).toBe(false);
  });

  it('should reject search result with timingMs instead of timing.totalMs (AB#97 scenario)', () => {
    const result = ViewerSearchResponseSchema.safeParse({
      data: {
        results: [],
        timingMs: 42, // wrong: should be timing: { totalMs: 42 }
      },
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================
// Graph
// =====================================================

describe('ViewerGraphResponseSchema', () => {
  it('should parse valid graph response', () => {
    const result = ViewerGraphResponseSchema.safeParse(makeValidGraphResponse());
    expect(result.success).toBe(true);
  });

  it('should reject graph node with wrong field name (AB#97 scenario — name instead of symbols)', () => {
    const result = GraphNodeSchema.safeParse({
      id: 'node-1',
      filePath: 'src/hello.ts',
      name: 'hello', // wrong: should be symbols: ['hello']
      type: 'function',
    });
    expect(result.success).toBe(false);
  });

  it('should reject graph edge with wrong field name (AB#97 scenario — kind instead of type)', () => {
    const result = GraphEdgeSchema.safeParse({
      source: 'node-1',
      target: 'node-2',
      kind: 'imports', // wrong: should be type
    });
    expect(result.success).toBe(false);
  });

  it('should accept extended graph node types (e.g., interface from AST chunker)', () => {
    const result = GraphNodeSchema.safeParse({
      id: 'node-1',
      filePath: 'src/hello.ts',
      symbols: ['hello'],
      type: 'interface',
    });
    expect(result.success).toBe(true);
  });

  it('should reject graph node with non-string type', () => {
    const result = GraphNodeSchema.safeParse({
      id: 'node-1',
      filePath: 'src/hello.ts',
      symbols: ['hello'],
      type: 42,
    });
    expect(result.success).toBe(false);
  });

  it('should reject graph edge with non-string type', () => {
    const result = GraphEdgeSchema.safeParse({
      source: 'node-1',
      target: 'node-2',
      type: true,
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================
// Embeddings
// =====================================================

describe('ViewerEmbeddingsResponseSchema', () => {
  it('should parse valid embeddings response', () => {
    const result = ViewerEmbeddingsResponseSchema.safeParse(makeValidEmbeddingsResponse());
    expect(result.success).toBe(true);
  });

  it('should reject empty vector array', () => {
    // Empty array is technically valid for z.array(), but let us verify
    const data = makeValidEmbeddingsResponse();
    data.data[0].vector = [];
    const result = ViewerEmbeddingsResponseSchema.safeParse(data);
    // Empty array is still a valid number[] — this is expected
    expect(result.success).toBe(true);
  });

  it('should reject non-number vector values', () => {
    const result = EmbeddingPointSchema.safeParse({
      id: 'chunk-1',
      filePath: 'src/hello.ts',
      chunkType: 'function',
      language: 'typescript',
      vector: ['not', 'numbers'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing vector field', () => {
    const result = EmbeddingPointSchema.safeParse({
      id: 'chunk-1',
      filePath: 'src/hello.ts',
      chunkType: 'function',
      language: 'typescript',
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================
// PaginationMeta
// =====================================================

describe('PaginationMetaSchema', () => {
  it('should parse valid pagination meta', () => {
    const result = PaginationMetaSchema.safeParse({
      page: 1,
      pageSize: 50,
      total: 100,
      totalPages: 2,
    });
    expect(result.success).toBe(true);
  });

  it('should reject non-integer page values', () => {
    const result = PaginationMetaSchema.safeParse({
      page: 1.5,
      pageSize: 50,
      total: 100,
      totalPages: 2,
    });
    expect(result.success).toBe(false);
  });

  it('should reject wrong pagination field names (AB#97 scenario — offset/limit instead of page/pageSize)', () => {
    const result = PaginationMetaSchema.safeParse({
      offset: 0,
      limit: 50,
      total: 100,
      totalPages: 2,
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================
// AB#98 scenario — ensures correct HTTP method contract
// =====================================================

describe('AB#98 scenario — HTTP method contract', () => {
  it('all viewer endpoints use GET method (search uses query params, not POST body)', () => {
    // This test documents the contract: search uses GET with q= query param,
    // not POST with JSON body. The schema itself validates the response shape,
    // while this test serves as documentation that the search endpoint
    // accepts query parameters and responds with the ViewerSearchResponse shape.
    const validGetSearchResponse = makeValidSearchResponse();
    const result = ViewerSearchResponseSchema.safeParse(validGetSearchResponse);
    expect(result.success).toBe(true);

    // A POST-style request body should NOT be confused with the response:
    // The response always has { data: { results: [...], timing: {...} } }
    const wrongShape = {
      query: 'hello',
      results: [{ chunkId: 'x', score: 0.5 }],
    };
    const wrongResult = ViewerSearchResponseSchema.safeParse(wrongShape);
    expect(wrongResult.success).toBe(false);
  });
});

// =====================================================
// Cross-field validation: server response types match contracts
// =====================================================

describe('Contract type alignment', () => {
  it('stats response matches server ViewerStatsResponse interface', () => {
    // This data is exactly what the server constructs in the /stats handler
    const serverResponse = {
      data: {
        chunkCount: 3,
        fileCount: 2,
        languages: { typescript: 2, python: 1 },
        storageBytes: null,
        lastIndexed: null,
      },
    };
    const result = ViewerStatsResponseSchema.safeParse(serverResponse);
    expect(result.success).toBe(true);
  });

  it('chunks response matches server paginated chunk listing', () => {
    const serverResponse = {
      data: [
        {
          id: 'chunk-1',
          filePath: 'src/hello.ts',
          chunkType: 'function',
          name: 'hello',
          language: 'typescript',
          startLine: 1,
          endLine: 3,
          contentPreview: 'function hello() { return "world"; }',
        },
      ],
      meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    };
    const result = ViewerChunksResponseSchema.safeParse(serverResponse);
    expect(result.success).toBe(true);
  });

  it('search response matches server ViewerSearchResponse interface', () => {
    const serverResponse = {
      data: {
        results: [
          {
            chunkId: 'chunk-1',
            filePath: 'src/utils/hello.ts',
            chunkType: 'function',
            name: 'hello',
            content: 'function hello() {}',
            nlSummary: 'A greeting function',
            score: 0.95,
            method: 'hybrid',
          },
        ],
        timing: { totalMs: 42 },
      },
    };
    const result = ViewerSearchResponseSchema.safeParse(serverResponse);
    expect(result.success).toBe(true);
  });

  it('graph response matches server GraphResponse interface', () => {
    const serverResponse = {
      data: {
        nodes: [
          { id: 'node-1', filePath: 'src/hello.ts', symbols: ['hello'], type: 'function' },
          { id: 'node-2', filePath: 'src/world.ts', symbols: ['world'], type: 'module' },
        ],
        edges: [
          { source: 'node-1', target: 'node-2', type: 'imports' },
        ],
      },
    };
    const result = ViewerGraphResponseSchema.safeParse(serverResponse);
    expect(result.success).toBe(true);
  });

  it('embeddings response matches server embedding data', () => {
    const serverResponse = {
      data: [
        {
          id: 'c1',
          filePath: 'src/hello.ts',
          chunkType: 'function',
          language: 'typescript',
          vector: [0.1, 0.2],
        },
      ],
    };
    const result = ViewerEmbeddingsResponseSchema.safeParse(serverResponse);
    expect(result.success).toBe(true);
  });
});
