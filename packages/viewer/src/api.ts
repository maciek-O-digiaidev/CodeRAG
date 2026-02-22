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
  limit?: number;
  mode?: 'hybrid' | 'semantic' | 'keyword';
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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
      return fetchJson<StatsResponse>(`${BASE_URL}/stats`);
    },

    getChunks(params?: ChunkQueryParams): Promise<PaginatedResponse<ChunkSummary>> {
      const qs = params ? buildQueryString(params) : '';
      return fetchJson<PaginatedResponse<ChunkSummary>>(`${BASE_URL}/chunks${qs}`);
    },

    getChunk(id: string, includeVector?: boolean): Promise<ChunkDetail> {
      const qs = includeVector !== undefined ? buildQueryString({ includeVector }) : '';
      return fetchJson<ChunkDetail>(`${BASE_URL}/chunks/${encodeURIComponent(id)}${qs}`);
    },

    getGraph(params?: GraphQueryParams): Promise<GraphResponse> {
      const qs = params ? buildQueryString(params) : '';
      return fetchJson<GraphResponse>(`${BASE_URL}/graph${qs}`);
    },

    search(params: SearchParams): Promise<SearchResponse> {
      return postJson<SearchResponse>(`${BASE_URL}/search`, params);
    },

    getEmbeddings(limit?: number): Promise<EmbeddingPoint[]> {
      const qs = limit !== undefined ? buildQueryString({ limit }) : '';
      return fetchJson<{ data: EmbeddingPoint[] }>(`${BASE_URL}/embeddings${qs}`).then(
        (response) => response.data,
      );
    },
  };
}
