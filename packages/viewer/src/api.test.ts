import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiClient, ApiError, type StatsResponse, type SearchResponse, type EmbeddingPoint } from './api.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  } as Response;
}

function mockErrorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
  } as Response;
}

describe('ApiClient', () => {
  const client = createApiClient();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStats', () => {
    it('should fetch stats from the correct endpoint', async () => {
      const stats: StatsResponse = {
        totalChunks: 100,
        totalFiles: 20,
        totalEmbeddings: 95,
        languages: { typescript: 80, javascript: 20 },
        lastIndexedAt: '2026-02-22T10:00:00Z',
      };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(stats));

      const result = await client.getStats();

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/viewer/stats');
      expect(result).toEqual(stats);
    });

    it('should throw ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(client.getStats()).rejects.toThrow(ApiError);
      await expect(client.getStats()).rejects.toThrow('API error: 500 Internal Server Error');
    });
  });

  describe('getChunks', () => {
    it('should fetch chunks without params and unwrap data envelope', async () => {
      const backendResponse = {
        data: [
          { id: 'c1', filePath: 'src/a.ts', chunkType: 'function', name: 'hello', language: 'typescript', startLine: 1, endLine: 5 },
        ],
        meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
      };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(backendResponse));

      const result = await client.getChunks();

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/viewer/chunks');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.kind).toBe('function');
      expect(result.total).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(50);
    });

    it('should fetch chunks with query params', async () => {
      const backendResponse = {
        data: [],
        meta: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
      };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(backendResponse));

      await client.getChunks({ offset: 0, limit: 10, language: 'typescript' });

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('/api/v1/viewer/chunks?');
      expect(calledUrl).toContain('offset=0');
      expect(calledUrl).toContain('limit=10');
      expect(calledUrl).toContain('language=typescript');
    });
  });

  describe('getChunk', () => {
    it('should fetch a single chunk by ID and unwrap data envelope', async () => {
      const backendResponse = {
        data: {
          id: 'abc123',
          filePath: 'src/main.ts',
          chunkType: 'function',
          name: 'main',
          language: 'typescript',
          startLine: 1,
          endLine: 10,
          content: 'function main() {}',
          nlSummary: 'Main entry point',
          metadata: {},
        },
      };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(backendResponse));

      const result = await client.getChunk('abc123');

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/viewer/chunks/abc123');
      expect(result.id).toBe('abc123');
      expect(result.kind).toBe('function');
      expect(result.summary).toBe('Main entry point');
      expect(result.vector).toBeNull();
    });

    it('should include vector query param when requested', async () => {
      const backendResponse = {
        data: {
          id: 'abc123',
          filePath: 'src/main.ts',
          chunkType: 'function',
          name: 'main',
          language: 'typescript',
          startLine: 1,
          endLine: 10,
          content: 'function main() {}',
          nlSummary: '',
          metadata: {},
          vector: [0.1, 0.2, 0.3],
        },
      };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(backendResponse));

      const result = await client.getChunk('abc123', true);

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('includeVector=true');
      expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    });

    it('should encode special characters in chunk ID', async () => {
      const backendResponse = { data: { id: 'x', filePath: '', chunkType: '', name: '', language: '', startLine: 0, endLine: 0, content: '', nlSummary: '', metadata: {} } };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(backendResponse));

      await client.getChunk('path/to/file#chunk');

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain(encodeURIComponent('path/to/file#chunk'));
    });
  });

  describe('getGraph', () => {
    it('should fetch graph without params and unwrap data envelope', async () => {
      const backendResponse = {
        data: {
          nodes: [
            { id: 'n1', filePath: 'src/foo.ts', symbols: ['fooFn'], type: 'function' },
          ],
          edges: [
            { source: 'n1', target: 'n2', type: 'imports' },
          ],
        },
      };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(backendResponse));

      const result = await client.getGraph();

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/viewer/graph');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.kind).toBe('function');
      expect(result.nodes[0]!.name).toBe('fooFn');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.kind).toBe('imports');
    });

    it('should fetch graph with root node and depth', async () => {
      const backendResponse = { data: { nodes: [], edges: [] } };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(backendResponse));

      await client.getGraph({ rootId: 'node1', depth: 3 });

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('rootId=node1');
      expect(calledUrl).toContain('depth=3');
    });
  });

  describe('search', () => {
    it('should POST search query to the correct endpoint', async () => {
      const searchResponse: SearchResponse = {
        results: [],
        query: 'test query',
        totalResults: 0,
        timingMs: 42,
      };
      mockFetch.mockResolvedValueOnce(mockJsonResponse(searchResponse));

      const result = await client.search({ query: 'test query', limit: 10, mode: 'hybrid' });

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/viewer/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test query', limit: 10, mode: 'hybrid' }),
      });
      expect(result).toEqual(searchResponse);
    });

    it('should handle search errors', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(400, 'Bad Request'));

      await expect(client.search({ query: '' })).rejects.toThrow(ApiError);
    });
  });

  describe('getEmbeddings', () => {
    it('should fetch embeddings without limit', async () => {
      const points: EmbeddingPoint[] = [];
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ data: points }));

      const result = await client.getEmbeddings();

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/viewer/embeddings');
      expect(result).toEqual(points);
    });

    it('should fetch embeddings with limit param', async () => {
      const points: EmbeddingPoint[] = [];
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ data: points }));

      await client.getEmbeddings(100);

      const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('limit=100');
    });
  });

  describe('ApiError', () => {
    it('should contain status and statusText', () => {
      const error = new ApiError(404, 'Not Found');
      expect(error.status).toBe(404);
      expect(error.statusText).toBe('Not Found');
      expect(error.message).toBe('API error: 404 Not Found');
      expect(error.name).toBe('ApiError');
    });

    it('should accept custom message', () => {
      const error = new ApiError(500, 'Internal Server Error', 'Something went wrong');
      expect(error.message).toBe('Something went wrong');
    });
  });
});
