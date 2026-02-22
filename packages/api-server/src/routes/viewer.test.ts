import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ok, err } from 'neverthrow';
import { createViewerRouter, type ViewerDeps } from './viewer.js';
import type {
  LanceDBStore,
  CodeRAGConfig,
  HybridSearch,
  DependencyGraph,
  SearchResult,
} from '@coderag/core';
import { EmbedError, StoreError } from '@coderag/core';

// --- Mock LanceDB row shape ---

interface MockLanceDBRow {
  id: string;
  vector: number[];
  content: string;
  nl_summary: string;
  chunk_type: string;
  file_path: string;
  language: string;
  metadata: string;
}

function makeMockRow(overrides: Partial<MockLanceDBRow> = {}): MockLanceDBRow {
  return {
    id: 'chunk-1',
    vector: [0.1, 0.2, 0.3],
    content: 'function hello() { return "world"; }',
    nl_summary: 'A function that returns world',
    chunk_type: 'function',
    file_path: 'src/hello.ts',
    language: 'typescript',
    metadata: JSON.stringify({
      name: 'hello',
      chunk_type: 'function',
      start_line: 1,
      end_line: 3,
    }),
    ...overrides,
  };
}

// --- Mock factories ---

function makeMockStore(tableRows: MockLanceDBRow[] | null = []): LanceDBStore {
  const mockTable = tableRows !== null
    ? {
        query: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(tableRows),
        }),
        countRows: vi.fn().mockResolvedValue(tableRows.length),
      }
    : null;

  return {
    count: vi.fn().mockResolvedValue(ok(tableRows?.length ?? 0)),
    query: vi.fn().mockResolvedValue(ok([])),
    upsert: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    close: vi.fn(),
    table: mockTable,
  } as unknown as LanceDBStore;
}

function makeMockConfig(overrides: Partial<CodeRAGConfig> = {}): CodeRAGConfig {
  return {
    version: '1',
    project: { name: 'test-project', languages: ['typescript', 'python'] },
    ingestion: { maxTokensPerChunk: 512, exclude: [] },
    embedding: { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768 },
    llm: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    search: { topK: 10, vectorWeight: 0.7, bm25Weight: 0.3 },
    storage: { path: '.coderag' },
    ...overrides,
  };
}

function makeMockGraph(): DependencyGraph {
  return {
    getAllNodes: vi.fn().mockReturnValue([
      { id: 'node-1', filePath: 'src/hello.ts', symbols: ['hello'], type: 'function' },
      { id: 'node-2', filePath: 'src/world.ts', symbols: ['world'], type: 'module' },
      { id: 'node-3', filePath: 'src/utils/helper.ts', symbols: ['helper'], type: 'function' },
    ]),
    getAllEdges: vi.fn().mockReturnValue([
      { source: 'node-1', target: 'node-2', type: 'imports' },
      { source: 'node-3', target: 'node-1', type: 'calls' },
    ]),
    getNode: vi.fn(),
    getEdges: vi.fn().mockReturnValue([]),
    getIncomingEdges: vi.fn().mockReturnValue([]),
    nodeCount: vi.fn().mockReturnValue(3),
    edgeCount: vi.fn().mockReturnValue(2),
  } as unknown as DependencyGraph;
}

function makeMockHybridSearch(): HybridSearch {
  return {
    search: vi.fn().mockResolvedValue(ok([])),
  } as unknown as HybridSearch;
}

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

// --- Test app factory ---

function createTestApp(deps: Partial<ViewerDeps> = {}): express.Express {
  const app = express();
  app.use(express.json());

  const fullDeps: ViewerDeps = {
    getStore: deps.getStore ?? (() => null),
    getConfig: deps.getConfig ?? (() => null),
    getHybridSearch: deps.getHybridSearch ?? (() => null),
    getGraph: deps.getGraph ?? (() => null),
  };

  app.use('/api/v1/viewer', createViewerRouter(fullDeps));
  return app;
}

// =====================================================
// GET /api/v1/viewer/stats
// =====================================================

describe('GET /api/v1/viewer/stats', () => {
  it('should return index statistics when store is initialized', async () => {
    const rows = [makeMockRow(), makeMockRow({ id: 'chunk-2' })];
    const store = makeMockStore(rows);
    vi.mocked(store.count).mockResolvedValue(ok(42));
    const config = makeMockConfig();

    const app = createTestApp({
      getStore: () => store,
      getConfig: () => config,
    });

    const res = await request(app).get('/api/v1/viewer/stats');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      chunkCount: 42,
      fileCount: 9,
      languages: ['typescript', 'python'],
      storageBytes: null,
      lastIndexed: null,
    });
  });

  it('should return 503 when store is not initialized', async () => {
    const app = createTestApp({
      getStore: () => null,
    });

    const res = await request(app).get('/api/v1/viewer/stats');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('error', 'Service not initialized');
  });

  it('should handle store count errors', async () => {
    const store = makeMockStore([]);
    vi.mocked(store.count).mockResolvedValue(err(new StoreError('DB connection lost')));

    const app = createTestApp({
      getStore: () => store,
      getConfig: () => makeMockConfig(),
    });

    const res = await request(app).get('/api/v1/viewer/stats');

    expect(res.status).toBe(500);
    expect(res.body.message).toContain('DB connection lost');
  });

  it('should use auto languages when config has auto', async () => {
    const store = makeMockStore([]);
    vi.mocked(store.count).mockResolvedValue(ok(10));
    const config = makeMockConfig({
      project: { name: 'test', languages: 'auto' },
    });

    const app = createTestApp({
      getStore: () => store,
      getConfig: () => config,
    });

    const res = await request(app).get('/api/v1/viewer/stats');

    expect(res.status).toBe(200);
    expect(res.body.data.languages).toBe('auto');
  });
});

// =====================================================
// GET /api/v1/viewer/chunks
// =====================================================

describe('GET /api/v1/viewer/chunks', () => {
  const rows = [
    makeMockRow({ id: 'c1', file_path: 'src/a.ts', language: 'typescript', chunk_type: 'function' }),
    makeMockRow({ id: 'c2', file_path: 'src/b.py', language: 'python', chunk_type: 'class' }),
    makeMockRow({ id: 'c3', file_path: 'src/c.ts', language: 'typescript', chunk_type: 'interface' }),
  ];

  it('should return paginated chunk listing', async () => {
    const store = makeMockStore(rows);

    const app = createTestApp({
      getStore: () => store,
    });

    const res = await request(app).get('/api/v1/viewer/chunks');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.meta).toEqual({
      page: 1,
      pageSize: 50,
      total: 3,
      totalPages: 1,
    });
  });

  it('should filter by language', async () => {
    const store = makeMockStore(rows);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/chunks')
      .query({ language: 'typescript' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((c: { language: string }) => c.language === 'typescript')).toBe(true);
  });

  it('should filter by chunk type', async () => {
    const store = makeMockStore(rows);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/chunks')
      .query({ type: 'class' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].chunkType).toBe('class');
  });

  it('should filter by file path', async () => {
    const store = makeMockStore(rows);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/chunks')
      .query({ file: 'src/b.py' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('c2');
  });

  it('should filter by text query q', async () => {
    const store = makeMockStore([
      makeMockRow({ id: 'c1', content: 'function searchUser() {}' }),
      makeMockRow({ id: 'c2', content: 'function getProduct() {}' }),
    ]);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/chunks')
      .query({ q: 'searchUser' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('c1');
  });

  it('should paginate results', async () => {
    const manyRows = Array.from({ length: 5 }, (_, i) =>
      makeMockRow({ id: `chunk-${i}` }),
    );
    const store = makeMockStore(manyRows);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/chunks')
      .query({ page: 2, pageSize: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe('chunk-2');
    expect(res.body.data[1].id).toBe('chunk-3');
    expect(res.body.meta.total).toBe(5);
    expect(res.body.meta.totalPages).toBe(3);
  });

  it('should validate pageSize max', async () => {
    const store = makeMockStore(rows);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/chunks')
      .query({ pageSize: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation Error');
  });

  it('should handle empty results when table is null', async () => {
    const store = makeMockStore(null);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app).get('/api/v1/viewer/chunks');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  it('should return 503 when store is not initialized', async () => {
    const app = createTestApp({ getStore: () => null });

    const res = await request(app).get('/api/v1/viewer/chunks');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('error', 'Service not initialized');
  });
});

// =====================================================
// GET /api/v1/viewer/chunks/:id
// =====================================================

describe('GET /api/v1/viewer/chunks/:id', () => {
  const row = makeMockRow({ id: 'chunk-abc' });

  it('should return chunk detail for existing chunk', async () => {
    const store = makeMockStore([row]);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app).get('/api/v1/viewer/chunks/chunk-abc');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('chunk-abc');
    expect(res.body.data.content).toBe(row.content);
    expect(res.body.data.nlSummary).toBe(row.nl_summary);
    expect(res.body.data).not.toHaveProperty('vector');
  });

  it('should return 404 for missing chunk', async () => {
    const store = makeMockStore([row]);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app).get('/api/v1/viewer/chunks/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Chunk not found');
  });

  it('should include vector when includeVector=true', async () => {
    const store = makeMockStore([row]);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/chunks/chunk-abc')
      .query({ includeVector: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.data.vector).toEqual([0.1, 0.2, 0.3]);
  });

  it('should not include vector when includeVector=false', async () => {
    const store = makeMockStore([row]);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/chunks/chunk-abc')
      .query({ includeVector: 'false' });

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('vector');
  });

  it('should return 503 when store is not initialized', async () => {
    const app = createTestApp({ getStore: () => null });

    const res = await request(app).get('/api/v1/viewer/chunks/chunk-abc');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('error', 'Service not initialized');
  });

  it('should return 404 when table is null', async () => {
    const store = makeMockStore(null);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app).get('/api/v1/viewer/chunks/chunk-abc');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Chunk not found');
  });
});

// =====================================================
// GET /api/v1/viewer/graph
// =====================================================

describe('GET /api/v1/viewer/graph', () => {
  it('should return graph nodes and edges', async () => {
    const graph = makeMockGraph();
    const app = createTestApp({ getGraph: () => graph });

    const res = await request(app).get('/api/v1/viewer/graph');

    expect(res.status).toBe(200);
    expect(res.body.data.nodes).toHaveLength(3);
    expect(res.body.data.edges).toHaveLength(2);
  });

  it('should filter nodes by file', async () => {
    const graph = makeMockGraph();
    const app = createTestApp({ getGraph: () => graph });

    const res = await request(app)
      .get('/api/v1/viewer/graph')
      .query({ file: 'src/hello.ts' });

    expect(res.status).toBe(200);
    expect(res.body.data.nodes).toHaveLength(1);
    expect(res.body.data.nodes[0].id).toBe('node-1');
    // Only edges between filtered nodes
    expect(res.body.data.edges).toHaveLength(0);
  });

  it('should filter nodes by type', async () => {
    const graph = makeMockGraph();
    const app = createTestApp({ getGraph: () => graph });

    const res = await request(app)
      .get('/api/v1/viewer/graph')
      .query({ type: 'function' });

    expect(res.status).toBe(200);
    expect(res.body.data.nodes).toHaveLength(2);
    expect(res.body.data.nodes.every((n: { type: string }) => n.type === 'function')).toBe(true);
  });

  it('should respect maxNodes limit', async () => {
    const graph = makeMockGraph();
    const app = createTestApp({ getGraph: () => graph });

    const res = await request(app)
      .get('/api/v1/viewer/graph')
      .query({ maxNodes: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.nodes).toHaveLength(2);
  });

  it('should return 503 when graph is not initialized', async () => {
    const app = createTestApp({ getGraph: () => null });

    const res = await request(app).get('/api/v1/viewer/graph');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('error', 'Service not initialized');
  });
});

// =====================================================
// GET /api/v1/viewer/search
// =====================================================

describe('GET /api/v1/viewer/search', () => {
  it('should return search results with timing', async () => {
    const hybridSearch = makeMockHybridSearch();
    const results = [makeSearchResult()];
    vi.mocked(hybridSearch.search).mockResolvedValue(ok(results));

    const app = createTestApp({ getHybridSearch: () => hybridSearch });

    const res = await request(app)
      .get('/api/v1/viewer/search')
      .query({ q: 'hello function' });

    expect(res.status).toBe(200);
    expect(res.body.data.results).toHaveLength(1);
    expect(res.body.data.results[0]).toEqual({
      chunkId: 'chunk-1',
      filePath: 'src/utils/hello.ts',
      chunkType: 'function',
      name: 'hello',
      content: 'function hello() {}',
      nlSummary: 'A greeting function',
      score: 0.95,
      method: 'hybrid',
    });
    expect(res.body.data.timing).toHaveProperty('totalMs');
    expect(typeof res.body.data.timing.totalMs).toBe('number');
  });

  it('should return 400 when q param is missing', async () => {
    const hybridSearch = makeMockHybridSearch();
    const app = createTestApp({ getHybridSearch: () => hybridSearch });

    const res = await request(app).get('/api/v1/viewer/search');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation Error');
  });

  it('should pass custom topK to search', async () => {
    const hybridSearch = makeMockHybridSearch();
    vi.mocked(hybridSearch.search).mockResolvedValue(ok([]));
    const app = createTestApp({ getHybridSearch: () => hybridSearch });

    await request(app)
      .get('/api/v1/viewer/search')
      .query({ q: 'test', topK: 5 });

    expect(hybridSearch.search).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ topK: 5 }),
    );
  });

  it('should pass custom weights to search', async () => {
    const hybridSearch = makeMockHybridSearch();
    vi.mocked(hybridSearch.search).mockResolvedValue(ok([]));
    const app = createTestApp({ getHybridSearch: () => hybridSearch });

    await request(app)
      .get('/api/v1/viewer/search')
      .query({ q: 'test', vectorWeight: 0.8, bm25Weight: 0.2 });

    expect(hybridSearch.search).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ vectorWeight: 0.8, bm25Weight: 0.2 }),
    );
  });

  it('should handle search errors', async () => {
    const hybridSearch = makeMockHybridSearch();
    vi.mocked(hybridSearch.search).mockResolvedValue(
      err(new EmbedError('Connection refused')),
    );
    const app = createTestApp({ getHybridSearch: () => hybridSearch });

    const res = await request(app)
      .get('/api/v1/viewer/search')
      .query({ q: 'hello' });

    expect(res.status).toBe(500);
    expect(res.body.message).toContain('Connection refused');
  });

  it('should return 503 when search is not initialized', async () => {
    const app = createTestApp({ getHybridSearch: () => null });

    const res = await request(app)
      .get('/api/v1/viewer/search')
      .query({ q: 'hello' });

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('error', 'Service not initialized');
  });
});

// =====================================================
// GET /api/v1/viewer/embeddings
// =====================================================

describe('GET /api/v1/viewer/embeddings', () => {
  it('should return embedding vectors', async () => {
    const rows = [
      makeMockRow({ id: 'c1', vector: [0.1, 0.2] }),
      makeMockRow({ id: 'c2', vector: [0.3, 0.4] }),
    ];
    const store = makeMockStore(rows);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app).get('/api/v1/viewer/embeddings');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({
      id: 'c1',
      filePath: 'src/hello.ts',
      chunkType: 'function',
      language: 'typescript',
      vector: [0.1, 0.2],
    });
  });

  it('should respect limit parameter', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeMockRow({ id: `c-${i}`, vector: [i, i + 1] }),
    );
    const store = makeMockStore(rows);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/embeddings')
      .query({ limit: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  it('should return empty array when table is null', async () => {
    const store = makeMockStore(null);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app).get('/api/v1/viewer/embeddings');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('should return 503 when store is not initialized', async () => {
    const app = createTestApp({ getStore: () => null });

    const res = await request(app).get('/api/v1/viewer/embeddings');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('error', 'Service not initialized');
  });

  it('should validate limit max value', async () => {
    const store = makeMockStore([]);
    const app = createTestApp({ getStore: () => store });

    const res = await request(app)
      .get('/api/v1/viewer/embeddings')
      .query({ limit: 9999 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation Error');
  });
});
