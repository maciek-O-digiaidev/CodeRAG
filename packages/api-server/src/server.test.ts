import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { ok, err } from 'neverthrow';
import { ApiServer } from './server.js';
import { parseApiKeys } from './middleware/auth.js';
import { parseRateLimitConfig, createRateLimitMiddleware } from './middleware/rate-limit.js';
import { createOpenAPISpec } from './openapi.js';
import type {
  HybridSearch,
  ContextExpander,
  LanceDBStore,
  CodeRAGConfig,
  SearchResult,
  ExpandedContext,
} from '@coderag/core';
import { EmbedError, StoreError } from '@coderag/core';
import express from 'express';

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

/**
 * Create an ApiServer with mocked core services injected.
 * We use a custom approach: create the server without initialize(),
 * then directly test the Express app with supertest.
 */
function createTestServer(options?: {
  apiKeys?: string;
  onIndex?: () => Promise<{ indexed_files: number; duration_ms: number }>;
}): {
  server: ApiServer;
  mockHybridSearch: HybridSearch;
  mockContextExpander: ContextExpander;
  mockStore: LanceDBStore;
  mockConfig: CodeRAGConfig;
} {
  const mockHybridSearch = {
    search: vi.fn().mockResolvedValue(ok([])),
  } as unknown as HybridSearch;

  const mockContextExpander = {
    expand: vi.fn().mockReturnValue({
      primaryResults: [],
      relatedChunks: [],
      graphExcerpt: { nodes: [], edges: [] },
    } satisfies ExpandedContext),
  } as unknown as ContextExpander;

  const mockStore = {
    count: vi.fn().mockResolvedValue(ok(42)),
  } as unknown as LanceDBStore;

  const mockConfig: CodeRAGConfig = {
    version: '1',
    project: { name: 'test-project', languages: ['typescript'] },
    ingestion: { maxTokensPerChunk: 512, exclude: [] },
    embedding: { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768, autoStart: true, autoStop: false, docker: { image: 'ollama/ollama', gpu: 'auto' } },
    llm: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    search: { topK: 10, vectorWeight: 0.7, bm25Weight: 0.3 },
    storage: { path: '.coderag' },
  };

  const apiKeys = parseApiKeys(options?.apiKeys);

  const server = new ApiServer({
    rootDir: '/tmp/test',
    port: 0,
    apiKeys,
    onIndex: options?.onIndex ?? null,
  });

  // Inject mocked services via casting (they are private fields)
  const serverInternal = server as unknown as {
    hybridSearch: HybridSearch | null;
    contextExpander: ContextExpander | null;
    store: LanceDBStore | null;
    config: CodeRAGConfig | null;
  };
  serverInternal.hybridSearch = mockHybridSearch;
  serverInternal.contextExpander = mockContextExpander;
  serverInternal.store = mockStore;
  serverInternal.config = mockConfig;

  return { server, mockHybridSearch, mockContextExpander, mockStore, mockConfig };
}

// --- Health Check Tests ---

describe('GET /health', () => {
  it('should return 200 with ok status', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('should not require authentication', async () => {
    const { server } = createTestServer({ apiKeys: 'secret-key' });
    const res = await request(server.getApp()).get('/health');

    expect(res.status).toBe(200);
  });
});

// --- OpenAPI Spec Tests ---

describe('GET /api/openapi.json', () => {
  it('should return the OpenAPI spec', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp()).get('/api/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi', '3.0.3');
    expect(res.body).toHaveProperty('info');
    expect(res.body.info).toHaveProperty('title', 'CodeRAG Cloud API');
    expect(res.body).toHaveProperty('paths');
  });

  it('should not require authentication', async () => {
    const { server } = createTestServer({ apiKeys: 'secret-key' });
    const res = await request(server.getApp()).get('/api/openapi.json');

    expect(res.status).toBe(200);
  });
});

// --- CORS Tests ---

describe('CORS', () => {
  it('should return CORS headers', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp()).get('/health');

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('should handle OPTIONS preflight', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp()).options('/api/v1/search');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });
});

// --- Auth Middleware Tests ---

describe('Authentication', () => {
  it('should allow requests when no API keys configured (auth disabled)', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp())
      .get('/api/v1/status');

    expect(res.status).toBe(200);
  });

  it('should reject requests with missing API key when keys are configured', async () => {
    const { server } = createTestServer({ apiKeys: 'my-key' });
    const res = await request(server.getApp())
      .get('/api/v1/status');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'Unauthorized');
  });

  it('should reject requests with invalid API key', async () => {
    const { server } = createTestServer({ apiKeys: 'my-key' });
    const res = await request(server.getApp())
      .get('/api/v1/status')
      .set('Authorization', 'Bearer wrong-key');

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('Invalid API key');
  });

  it('should accept valid API key via Authorization: Bearer', async () => {
    const { server } = createTestServer({ apiKeys: 'my-key' });
    const res = await request(server.getApp())
      .get('/api/v1/status')
      .set('Authorization', 'Bearer my-key');

    expect(res.status).toBe(200);
  });

  it('should accept valid API key via X-API-Key header', async () => {
    const { server } = createTestServer({ apiKeys: 'my-key' });
    const res = await request(server.getApp())
      .get('/api/v1/status')
      .set('X-API-Key', 'my-key');

    expect(res.status).toBe(200);
  });

  it('should support multiple API keys', async () => {
    const { server } = createTestServer({ apiKeys: 'key1,key2,key3' });

    const res1 = await request(server.getApp())
      .get('/api/v1/status')
      .set('Authorization', 'Bearer key1');
    expect(res1.status).toBe(200);

    const res2 = await request(server.getApp())
      .get('/api/v1/status')
      .set('Authorization', 'Bearer key2');
    expect(res2.status).toBe(200);

    const res3 = await request(server.getApp())
      .get('/api/v1/status')
      .set('Authorization', 'Bearer key3');
    expect(res3.status).toBe(200);
  });
});

// --- parseApiKeys Tests ---

describe('parseApiKeys', () => {
  it('should return empty array for undefined', () => {
    expect(parseApiKeys(undefined)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseApiKeys('')).toEqual([]);
  });

  it('should parse single key', () => {
    const keys = parseApiKeys('my-key');
    expect(keys).toEqual([{ key: 'my-key', admin: false }]);
  });

  it('should parse multiple comma-separated keys', () => {
    const keys = parseApiKeys('key1,key2,key3');
    expect(keys).toHaveLength(3);
    expect(keys.every((k) => !k.admin)).toBe(true);
  });

  it('should parse admin keys', () => {
    const keys = parseApiKeys('regular-key,admin-key:admin');
    expect(keys).toEqual([
      { key: 'regular-key', admin: false },
      { key: 'admin-key', admin: true },
    ]);
  });

  it('should trim whitespace', () => {
    const keys = parseApiKeys(' key1 , key2:admin ');
    expect(keys).toEqual([
      { key: 'key1', admin: false },
      { key: 'key2', admin: true },
    ]);
  });

  it('should skip empty entries', () => {
    const keys = parseApiKeys('key1,,key2,');
    expect(keys).toHaveLength(2);
  });
});

// --- Rate Limit Tests ---

describe('Rate Limiting', () => {
  it('should allow requests under the limit', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp())
      .get('/api/v1/status');

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('should return 429 when rate limit exceeded', async () => {
    // Create a dedicated express app with a low rate limit for this test
    const app = express();
    app.use(express.json());
    app.use(createRateLimitMiddleware({ maxRequests: 2, windowMs: 60_000 }));
    app.get('/test', (_req, res) => { res.json({ ok: true }); });

    // First two requests should succeed
    const res1 = await request(app).get('/test');
    expect(res1.status).toBe(200);

    const res2 = await request(app).get('/test');
    expect(res2.status).toBe(200);

    // Third should be rate limited
    const res3 = await request(app).get('/test');
    expect(res3.status).toBe(429);
    expect(res3.body).toHaveProperty('error', 'Too Many Requests');
    expect(res3.headers['retry-after']).toBeDefined();
  });
});

// --- parseRateLimitConfig Tests ---

describe('parseRateLimitConfig', () => {
  it('should return defaults for empty env', () => {
    const config = parseRateLimitConfig({});
    expect(config.maxRequests).toBe(60);
    expect(config.windowMs).toBe(60_000);
  });

  it('should parse CODERAG_RATE_LIMIT', () => {
    const config = parseRateLimitConfig({ CODERAG_RATE_LIMIT: '100' });
    expect(config.maxRequests).toBe(100);
  });

  it('should parse CODERAG_RATE_WINDOW_MS', () => {
    const config = parseRateLimitConfig({ CODERAG_RATE_WINDOW_MS: '30000' });
    expect(config.windowMs).toBe(30_000);
  });

  it('should use defaults for invalid values', () => {
    const config = parseRateLimitConfig({ CODERAG_RATE_LIMIT: 'invalid' });
    expect(config.maxRequests).toBe(60);
  });

  it('should use defaults for negative values', () => {
    const config = parseRateLimitConfig({ CODERAG_RATE_LIMIT: '-5' });
    expect(config.maxRequests).toBe(60);
  });
});

// --- Search Endpoint Tests ---

describe('POST /api/v1/search', () => {
  it('should return search results for a valid query', async () => {
    const { server, mockHybridSearch } = createTestServer();
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const res = await request(server.getApp())
      .post('/api/v1/search')
      .send({ query: 'hello function' });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toEqual({
      file_path: 'src/utils/hello.ts',
      chunk_type: 'function',
      name: 'hello',
      content: 'function hello() {}',
      nl_summary: 'A greeting function',
      score: 0.95,
    });
    expect(res.body.total).toBe(1);
  });

  it('should return 400 for missing query', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp())
      .post('/api/v1/search')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation Error');
  });

  it('should return 400 for empty query', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp())
      .post('/api/v1/search')
      .send({ query: '' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for path traversal in file_path', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp())
      .post('/api/v1/search')
      .send({ query: 'hello', file_path: '../../etc/passwd' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for top_k above 100', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp())
      .post('/api/v1/search')
      .send({ query: 'hello', top_k: 200 });

    expect(res.status).toBe(400);
  });

  it('should filter by language', async () => {
    const { server, mockHybridSearch } = createTestServer();
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

    const res = await request(server.getApp())
      .post('/api/v1/search')
      .send({ query: 'hello', language: 'typescript' });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });

  it('should handle search API errors', async () => {
    const { server, mockHybridSearch } = createTestServer();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(
      err(new EmbedError('Connection refused')),
    );

    const res = await request(server.getApp())
      .post('/api/v1/search')
      .send({ query: 'hello' });

    expect(res.status).toBe(500);
    expect(res.body.message).toContain('Connection refused');
  });

  it('should return 503 when search index is not initialized', async () => {
    const server = new ApiServer({ rootDir: '/tmp/test', port: 0 });
    // Don't inject mocks — services remain null

    const res = await request(server.getApp())
      .post('/api/v1/search')
      .send({ query: 'hello' });

    expect(res.status).toBe(503);
    expect(res.body.message).toContain('not initialized');
  });

  it('should use custom top_k', async () => {
    const { server, mockHybridSearch } = createTestServer();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([]));

    await request(server.getApp())
      .post('/api/v1/search')
      .send({ query: 'hello', top_k: 5 });

    expect(mockHybridSearch.search).toHaveBeenCalledWith('hello', { topK: 5 });
  });
});

// --- Context Endpoint Tests ---

describe('POST /api/v1/context', () => {
  it('should return context for a valid file path', async () => {
    const { server, mockHybridSearch, mockContextExpander } = createTestServer();
    const results = [makeSearchResult()];
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok(results));

    const expandedContext: ExpandedContext = {
      primaryResults: results,
      relatedChunks: [],
      graphExcerpt: { nodes: [], edges: [] },
    };
    vi.mocked(mockContextExpander.expand).mockReturnValue(expandedContext);

    const res = await request(server.getApp())
      .post('/api/v1/context')
      .send({ file_path: 'src/utils/hello.ts' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('context');
    expect(res.body).toHaveProperty('token_count');
    expect(res.body).toHaveProperty('truncated');
    expect(res.body).toHaveProperty('primary_chunks');
    expect(res.body).toHaveProperty('related_chunks');
  });

  it('should return 400 for missing file_path', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp())
      .post('/api/v1/context')
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 400 for path traversal', async () => {
    const { server } = createTestServer();
    const res = await request(server.getApp())
      .post('/api/v1/context')
      .send({ file_path: '../../etc/passwd' });

    expect(res.status).toBe(400);
  });

  it('should return 503 when services not initialized', async () => {
    const server = new ApiServer({ rootDir: '/tmp/test', port: 0 });

    const res = await request(server.getApp())
      .post('/api/v1/context')
      .send({ file_path: 'src/index.ts' });

    expect(res.status).toBe(503);
  });

  it('should return empty context when no chunks match', async () => {
    const { server, mockHybridSearch } = createTestServer();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(ok([]));

    const res = await request(server.getApp())
      .post('/api/v1/context')
      .send({ file_path: 'nonexistent.ts' });

    expect(res.status).toBe(200);
    expect(res.body.context).toBe('');
    expect(res.body.message).toContain('No chunks found');
  });

  it('should handle search failures', async () => {
    const { server, mockHybridSearch } = createTestServer();
    vi.mocked(mockHybridSearch.search).mockResolvedValue(
      err(new EmbedError('Embedding unavailable')),
    );

    const res = await request(server.getApp())
      .post('/api/v1/context')
      .send({ file_path: 'src/index.ts' });

    expect(res.status).toBe(500);
    expect(res.body.message).toContain('Embedding unavailable');
  });
});

// --- Status Endpoint Tests ---

describe('GET /api/v1/status', () => {
  it('should return status with chunks and model info', async () => {
    const { server } = createTestServer();

    const res = await request(server.getApp())
      .get('/api/v1/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_chunks', 42);
    expect(res.body).toHaveProperty('health', 'ok');
    expect(res.body).toHaveProperty('model', 'nomic-embed-text');
    expect(res.body).toHaveProperty('languages');
  });

  it('should return not_initialized when store is null', async () => {
    const server = new ApiServer({ rootDir: '/tmp/test', port: 0 });

    const res = await request(server.getApp())
      .get('/api/v1/status');

    expect(res.status).toBe(200);
    expect(res.body.health).toBe('not_initialized');
    expect(res.body.total_chunks).toBe(0);
  });

  it('should return degraded when store count fails', async () => {
    const { server, mockStore } = createTestServer();
    vi.mocked(mockStore.count).mockResolvedValue(
      err(new StoreError('DB connection lost')),
    );

    const res = await request(server.getApp())
      .get('/api/v1/status');

    expect(res.status).toBe(200);
    expect(res.body.health).toBe('degraded');
  });

  it('should return degraded when store is empty', async () => {
    const { server, mockStore } = createTestServer();
    vi.mocked(mockStore.count).mockResolvedValue(ok(0));

    const res = await request(server.getApp())
      .get('/api/v1/status');

    expect(res.status).toBe(200);
    expect(res.body.health).toBe('degraded');
  });
});

// --- Index Trigger Endpoint Tests ---

describe('POST /api/v1/index', () => {
  it('should trigger indexing with admin key', async () => {
    const onIndex = vi.fn().mockResolvedValue({ indexed_files: 50, duration_ms: 1200 });
    const { server } = createTestServer({
      apiKeys: 'admin-key:admin',
      onIndex,
    });

    const res = await request(server.getApp())
      .post('/api/v1/index')
      .set('Authorization', 'Bearer admin-key')
      .send({ force: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'completed',
      indexed_files: 50,
      duration_ms: 1200,
    });
    expect(onIndex).toHaveBeenCalledWith({ force: true, rootDir: undefined });
  });

  it('should return 403 for non-admin key', async () => {
    const onIndex = vi.fn().mockResolvedValue({ indexed_files: 0, duration_ms: 0 });
    const { server } = createTestServer({
      apiKeys: 'regular-key',
      onIndex,
    });

    const res = await request(server.getApp())
      .post('/api/v1/index')
      .set('Authorization', 'Bearer regular-key')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('should return 401 for missing key when auth is enabled', async () => {
    const { server } = createTestServer({ apiKeys: 'admin-key:admin' });

    const res = await request(server.getApp())
      .post('/api/v1/index')
      .send({});

    expect(res.status).toBe(401);
  });

  it('should return 503 when index callback is not configured', async () => {
    const { server } = createTestServer({ apiKeys: 'admin-key:admin' });

    // No onIndex callback provided, and createTestServer uses null
    const serverInternal = server as unknown as {
      app: express.Express;
    };

    const res = await request(serverInternal.app)
      .post('/api/v1/index')
      .set('Authorization', 'Bearer admin-key')
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.message).toContain('not configured');
  });

  it('should allow index when auth is disabled (no keys configured)', async () => {
    const onIndex = vi.fn().mockResolvedValue({ indexed_files: 10, duration_ms: 500 });
    const { server } = createTestServer({ onIndex });

    const res = await request(server.getApp())
      .post('/api/v1/index')
      .send({});

    expect(res.status).toBe(200);
    expect(onIndex).toHaveBeenCalled();
  });

  it('should return 400 for path traversal in root_dir', async () => {
    const onIndex = vi.fn().mockResolvedValue({ indexed_files: 0, duration_ms: 0 });
    const { server } = createTestServer({ apiKeys: 'admin-key:admin', onIndex });

    const res = await request(server.getApp())
      .post('/api/v1/index')
      .set('Authorization', 'Bearer admin-key')
      .send({ root_dir: '../../etc' });

    expect(res.status).toBe(400);
  });

  it('should handle indexing errors', async () => {
    const onIndex = vi.fn().mockRejectedValue(new Error('Git not found'));
    const { server } = createTestServer({
      apiKeys: 'admin-key:admin',
      onIndex,
    });

    const res = await request(server.getApp())
      .post('/api/v1/index')
      .set('Authorization', 'Bearer admin-key')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.message).toContain('Git not found');
  });
});

// --- OpenAPI Spec Object Tests ---

describe('OpenAPI Spec', () => {
  it('should have the correct structure', () => {
    const spec = createOpenAPISpec();

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('CodeRAG Cloud API');
    expect(spec.info.version).toBe('0.1.0');
  });

  it('should define all API paths', () => {
    const spec = createOpenAPISpec();
    const paths = Object.keys(spec.paths);

    expect(paths).toContain('/api/v1/search');
    expect(paths).toContain('/api/v1/context');
    expect(paths).toContain('/api/v1/status');
    expect(paths).toContain('/api/v1/index');
    expect(paths).toContain('/health');
  });

  it('should define security schemes', () => {
    const spec = createOpenAPISpec();
    const components = spec.components as Record<string, Record<string, unknown>>;
    const schemes = components['securitySchemes'] as Record<string, Record<string, unknown>>;

    expect(schemes).toHaveProperty('bearerAuth');
    expect(schemes).toHaveProperty('apiKeyAuth');
    expect(spec.components).toHaveProperty('securitySchemes');
  });

  it('should define response schemas', () => {
    const spec = createOpenAPISpec();
    const components = spec.components as Record<string, Record<string, unknown>>;

    expect(components).toHaveProperty('schemas');
    expect(components).toHaveProperty('responses');

    const schemas = components['schemas'] as Record<string, unknown>;
    expect(schemas).toHaveProperty('SearchResult');
    expect(schemas).toHaveProperty('ContextResponse');
    expect(schemas).toHaveProperty('StatusResponse');
    expect(schemas).toHaveProperty('IndexResponse');
  });
});

// --- API Server Version Tests ---

describe('ApiServer', () => {
  it('should export API_SERVER_VERSION', async () => {
    const mod = await import('./server.js');
    expect(mod.API_SERVER_VERSION).toBe('0.1.0');
  });

  it('should create a server instance', () => {
    const server = new ApiServer({ rootDir: '/tmp/test', port: 3100 });
    expect(server).toBeDefined();
    expect(server.getApp()).toBeDefined();
  });

  it('should start and stop cleanly', async () => {
    const server = new ApiServer({ rootDir: '/tmp/test', port: 0 });
    // Port 0 would need actual listen; test close without start
    await server.close(); // should not throw
  });
});
