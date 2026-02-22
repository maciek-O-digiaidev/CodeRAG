const BASE_URL = '/api/v1/viewer';

// --- Response types ---

export interface StatsResponse {
  totalChunks: number;
  totalFiles: number;
  totalEmbeddings: number;
  languages: Record<string, number>;
  lastIndexedAt: string | null;
}

export interface ChunkSummary {
  id: string;
  filePath: string;
  name: string;
  kind: string;
  language: string;
  startLine: number;
  endLine: number;
}

export interface ChunkDetail extends ChunkSummary {
  content: string;
  summary: string | null;
  dependencies: string[];
  vector: number[] | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SearchResult {
  chunkId: string;
  score: number;
  filePath: string;
  name: string;
  kind: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalResults: number;
  timingMs: number;
}

export interface EmbeddingPoint {
  id: string;
  filePath: string;
  chunkType: string;
  language: string;
  vector: number[];
}

// --- Query parameter types ---

export interface ChunkQueryParams {
  offset?: number;
  limit?: number;
  language?: string;
  kind?: string;
  filePath?: string;
}

export interface GraphQueryParams {
  rootId?: string;
  depth?: number;
  kinds?: string[];
}

export interface SearchParams {
  query: string;
  topK?: number;
  vectorWeight?: number;
  bm25Weight?: number;
}

// --- API Client ---

export interface ApiClient {
  getStats(): Promise<StatsResponse>;
  getChunks(params?: ChunkQueryParams): Promise<PaginatedResponse<ChunkSummary>>;
  getChunk(id: string, includeVector?: boolean): Promise<ChunkDetail>;
  getGraph(params?: GraphQueryParams): Promise<GraphResponse>;
  search(params: SearchParams): Promise<SearchResponse>;
  getEmbeddings(limit?: number): Promise<EmbeddingPoint[]>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    message?: string,
  ) {
    super(message ?? `API error: ${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

function buildQueryString(params: object): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      (value as string[]).forEach((v) => searchParams.append(key, v));
    } else {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }
  return response.json() as Promise<T>;
}


/**
 * Create an API client for the CodeRAG viewer REST endpoints.
 */
export function createApiClient(): ApiClient {
  return {
    getStats(): Promise<StatsResponse> {
      return fetchJson<{
        data: {
          chunkCount: number;
          fileCount: number;
          languages: string[] | 'auto';
          storageBytes: number | null;
          lastIndexed: string | null;
        };
      }>(`${BASE_URL}/stats`).then((r) => ({
        totalChunks: r.data.chunkCount,
        totalFiles: r.data.fileCount,
        totalEmbeddings: r.data.chunkCount,
        languages: Array.isArray(r.data.languages)
          ? Object.fromEntries(r.data.languages.map((l) => [l, 1]))
          : {},
        lastIndexedAt: r.data.lastIndexed,
      }));
    },

    getChunks(params?: ChunkQueryParams): Promise<PaginatedResponse<ChunkSummary>> {
      const qs = params ? buildQueryString(params) : '';
      return fetchJson<{
        data: Array<{
          id: string;
          filePath: string;
          chunkType: string;
          name: string;
          language: string;
          startLine: number;
          endLine: number;
        }>;
        meta: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`${BASE_URL}/chunks${qs}`).then((r) => ({
        items: r.data.map((c) => ({
          id: c.id,
          filePath: c.filePath,
          name: c.name,
          kind: c.chunkType,
          language: c.language,
          startLine: c.startLine,
          endLine: c.endLine,
        })),
        total: r.meta.total,
        offset: (r.meta.page - 1) * r.meta.pageSize,
        limit: r.meta.pageSize,
      }));
    },

    getChunk(id: string, includeVector?: boolean): Promise<ChunkDetail> {
      const qs = includeVector !== undefined ? buildQueryString({ includeVector }) : '';
      return fetchJson<{
        data: {
          id: string;
          filePath: string;
          chunkType: string;
          name: string;
          language: string;
          startLine: number;
          endLine: number;
          content: string;
          nlSummary: string;
          metadata: Record<string, unknown>;
          vector?: number[];
        };
      }>(`${BASE_URL}/chunks/${encodeURIComponent(id)}${qs}`).then((r) => ({
        id: r.data.id,
        filePath: r.data.filePath,
        name: r.data.name,
        kind: r.data.chunkType,
        language: r.data.language,
        startLine: r.data.startLine,
        endLine: r.data.endLine,
        content: r.data.content,
        summary: r.data.nlSummary,
        dependencies: Array.isArray(r.data.metadata?.['dependencies'])
          ? (r.data.metadata['dependencies'] as string[])
          : [],
        vector: r.data.vector ?? null,
      }));
    },

    getGraph(params?: GraphQueryParams): Promise<GraphResponse> {
      const qs = params ? buildQueryString(params) : '';
      return fetchJson<{
        data: {
          nodes: Array<{ id: string; filePath: string; symbols: string[]; type: string }>;
          edges: Array<{ source: string; target: string; type: string }>;
        };
      }>(`${BASE_URL}/graph${qs}`).then((r) => ({
        nodes: r.data.nodes.map((n) => ({
          id: n.id,
          name: n.symbols[0] ?? n.id,
          kind: n.type,
          filePath: n.filePath,
        })),
        edges: r.data.edges.map((e) => ({
          source: e.source,
          target: e.target,
          kind: e.type,
        })),
      }));
    },

    search(params: SearchParams): Promise<SearchResponse> {
      const qs = buildQueryString({
        q: params.query,
        ...(params.topK !== undefined && { topK: params.topK }),
        ...(params.vectorWeight !== undefined && { vectorWeight: params.vectorWeight }),
        ...(params.bm25Weight !== undefined && { bm25Weight: params.bm25Weight }),
      });
      return fetchJson<{
        data: {
          results: Array<{
            chunkId: string;
            filePath: string;
            chunkType: string;
            name: string;
            content: string;
            nlSummary: string;
            score: number;
            method: string;
          }>;
          timing: { totalMs: number };
        };
      }>(`${BASE_URL}/search${qs}`).then((r) => ({
        results: r.data.results.map((sr) => ({
          chunkId: sr.chunkId,
          score: sr.score,
          filePath: sr.filePath,
          name: sr.name,
          kind: sr.chunkType,
          snippet: sr.nlSummary || sr.content.slice(0, 200),
        })),
        query: params.query,
        totalResults: r.data.results.length,
        timingMs: r.data.timing.totalMs,
      }));
    },

    getEmbeddings(limit?: number): Promise<EmbeddingPoint[]> {
      const qs = limit !== undefined ? buildQueryString({ limit }) : '';
      return fetchJson<{ data: EmbeddingPoint[] }>(`${BASE_URL}/embeddings${qs}`).then(
        (response) => response.data,
      );
    },
  };
}
