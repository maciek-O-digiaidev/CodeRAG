import {
  ViewerStatsResponseSchema,
  ViewerChunksResponseSchema,
  ViewerChunkDetailResponseSchema,
  ViewerSearchResponseSchema,
  ViewerGraphResponseSchema,
  ViewerEmbeddingsResponseSchema,
} from '@code-rag/core/api-contracts';

import type {
  ViewerStatsResponse,
  ViewerChunksResponse,
  ViewerChunkDetailResponse,
  ViewerSearchResponse,
  ViewerGraphResponse,
  ViewerEmbeddingsResponse,
} from '@code-rag/core/api-contracts';

const BASE_URL = '/api/v1/viewer';

// --- Viewer presentation types (view-layer abstractions) ---

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

// --- Mapping helpers: wire format -> presentation types ---

function mapStatsResponse(wire: ViewerStatsResponse): StatsResponse {
  return {
    totalChunks: wire.data.chunkCount,
    totalFiles: wire.data.fileCount,
    totalEmbeddings: wire.data.chunkCount,
    languages: wire.data.languages,
    lastIndexedAt: wire.data.lastIndexed,
  };
}

function mapChunksResponse(wire: ViewerChunksResponse): PaginatedResponse<ChunkSummary> {
  return {
    items: wire.data.map((c) => ({
      id: c.id,
      filePath: c.filePath,
      name: c.name,
      kind: c.chunkType,
      language: c.language,
      startLine: c.startLine,
      endLine: c.endLine,
    })),
    total: wire.meta.total,
    offset: (wire.meta.page - 1) * wire.meta.pageSize,
    limit: wire.meta.pageSize,
  };
}

function mapChunkDetailResponse(wire: ViewerChunkDetailResponse): ChunkDetail {
  const d = wire.data;
  return {
    id: d.id,
    filePath: d.filePath,
    name: d.name,
    kind: d.chunkType,
    language: d.language,
    startLine: d.startLine,
    endLine: d.endLine,
    content: d.content,
    summary: d.nlSummary,
    dependencies: Array.isArray(d.metadata?.['dependencies'])
      ? (d.metadata['dependencies'] as string[])
      : [],
    vector: d.vector ?? null,
  };
}

function mapGraphResponse(wire: ViewerGraphResponse): GraphResponse {
  return {
    nodes: wire.data.nodes.map((n) => ({
      id: n.id,
      name: n.symbols[0] ?? n.id,
      kind: n.type,
      filePath: n.filePath,
    })),
    edges: wire.data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.type,
    })),
  };
}

function mapSearchResponse(wire: ViewerSearchResponse, query: string): SearchResponse {
  return {
    results: wire.data.results.map((sr) => ({
      chunkId: sr.chunkId,
      score: sr.score,
      filePath: sr.filePath,
      name: sr.name,
      kind: sr.chunkType,
      snippet: sr.nlSummary || sr.content.slice(0, 200),
    })),
    query,
    totalResults: wire.data.results.length,
    timingMs: wire.data.timing.totalMs,
  };
}

function mapEmbeddingsResponse(wire: ViewerEmbeddingsResponse): EmbeddingPoint[] {
  return wire.data.map((p) => ({
    id: p.id,
    filePath: p.filePath,
    chunkType: p.chunkType,
    language: p.language,
    vector: p.vector,
  }));
}


/**
 * Create an API client for the CodeRAG viewer REST endpoints.
 *
 * Every fetch call validates the response against shared Zod schemas from
 * @code-rag/core/api-contracts, ensuring the server contract is enforced
 * at runtime. Any schema violation throws a ZodError.
 */
export function createApiClient(): ApiClient {
  return {
    async getStats(): Promise<StatsResponse> {
      const raw = await fetchJson<unknown>(`${BASE_URL}/stats`);
      const wire = ViewerStatsResponseSchema.parse(raw);
      return mapStatsResponse(wire);
    },

    async getChunks(params?: ChunkQueryParams): Promise<PaginatedResponse<ChunkSummary>> {
      const qs = params ? buildQueryString(params) : '';
      const raw = await fetchJson<unknown>(`${BASE_URL}/chunks${qs}`);
      const wire = ViewerChunksResponseSchema.parse(raw);
      return mapChunksResponse(wire);
    },

    async getChunk(id: string, includeVector?: boolean): Promise<ChunkDetail> {
      const qs = includeVector !== undefined ? buildQueryString({ includeVector }) : '';
      const raw = await fetchJson<unknown>(`${BASE_URL}/chunks/${encodeURIComponent(id)}${qs}`);
      const wire = ViewerChunkDetailResponseSchema.parse(raw);
      return mapChunkDetailResponse(wire);
    },

    async getGraph(params?: GraphQueryParams): Promise<GraphResponse> {
      const qs = params ? buildQueryString(params) : '';
      const raw = await fetchJson<unknown>(`${BASE_URL}/graph${qs}`);
      const wire = ViewerGraphResponseSchema.parse(raw);
      return mapGraphResponse(wire);
    },

    async search(params: SearchParams): Promise<SearchResponse> {
      const qs = buildQueryString({
        q: params.query,
        ...(params.topK !== undefined && { topK: params.topK }),
        ...(params.vectorWeight !== undefined && { vectorWeight: params.vectorWeight }),
        ...(params.bm25Weight !== undefined && { bm25Weight: params.bm25Weight }),
      });
      const raw = await fetchJson<unknown>(`${BASE_URL}/search${qs}`);
      const wire = ViewerSearchResponseSchema.parse(raw);
      return mapSearchResponse(wire, params.query);
    },

    async getEmbeddings(limit?: number): Promise<EmbeddingPoint[]> {
      const qs = limit !== undefined ? buildQueryString({ limit }) : '';
      const raw = await fetchJson<unknown>(`${BASE_URL}/embeddings${qs}`);
      const wire = ViewerEmbeddingsResponseSchema.parse(raw);
      return mapEmbeddingsResponse(wire);
    },
  };
}
