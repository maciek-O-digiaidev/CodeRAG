/**
 * Shared Zod schemas for the Viewer REST API contract.
 *
 * These schemas define the exact JSON shape that the api-server sends
 * and the viewer client receives. Both packages import these schemas so
 * that any drift between server responses and client expectations is
 * caught at compile time (type mismatch) or runtime (schema.parse()).
 *
 * Every schema here models the **wire format** including the `{ data }` envelope.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reusable sub-schemas
// ---------------------------------------------------------------------------

/** Pagination metadata returned alongside list endpoints. */
export const PaginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

/** A single chunk summary as returned by GET /chunks. */
export const ChunkSummarySchema = z.object({
  id: z.string(),
  filePath: z.string(),
  chunkType: z.string(),
  name: z.string(),
  language: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  contentPreview: z.string(),
});

/** Full chunk detail as returned by GET /chunks/:id. */
export const ChunkDetailSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  chunkType: z.string(),
  name: z.string(),
  language: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  content: z.string(),
  nlSummary: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  vector: z.array(z.number()).optional(),
});

/** Graph node as returned by the dependency-graph module.
 *  Uses z.string() for `type` because the actual types in practice extend beyond
 *  the core GraphNode union (e.g., 'interface' from AST chunker). TypeScript
 *  constrains the allowed values at compile time; Zod validates the wire shape. */
export const GraphNodeSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  symbols: z.array(z.string()),
  type: z.string(),
});

/** Graph edge as returned by the dependency-graph module.
 *  Uses z.string() for `type` for the same forward-compatibility reason. */
export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string(),
});

/** A single search result as returned by GET /search. */
export const ViewerSearchResultSchema = z.object({
  chunkId: z.string(),
  filePath: z.string(),
  chunkType: z.string(),
  name: z.string(),
  content: z.string(),
  nlSummary: z.string(),
  score: z.number(),
  method: z.string(),
});

/** A single embedding point as returned by GET /embeddings. */
export const EmbeddingPointSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  chunkType: z.string(),
  language: z.string(),
  vector: z.array(z.number()),
});

// ---------------------------------------------------------------------------
// Endpoint response schemas (full wire shape including envelope)
// ---------------------------------------------------------------------------

/** GET /api/v1/viewer/stats */
export const ViewerStatsResponseSchema = z.object({
  data: z.object({
    chunkCount: z.number().int(),
    fileCount: z.number().int(),
    languages: z.record(z.string(), z.number()),
    storageBytes: z.number().nullable(),
    lastIndexed: z.string().nullable(),
  }),
});

/** GET /api/v1/viewer/chunks */
export const ViewerChunksResponseSchema = z.object({
  data: z.array(ChunkSummarySchema),
  meta: PaginationMetaSchema,
});

/** GET /api/v1/viewer/chunks/:id */
export const ViewerChunkDetailResponseSchema = z.object({
  data: ChunkDetailSchema,
});

/** GET /api/v1/viewer/search */
export const ViewerSearchResponseSchema = z.object({
  data: z.object({
    results: z.array(ViewerSearchResultSchema),
    timing: z.object({
      totalMs: z.number(),
    }),
  }),
});

/** GET /api/v1/viewer/graph */
export const ViewerGraphResponseSchema = z.object({
  data: z.object({
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
  }),
});

/** GET /api/v1/viewer/embeddings */
export const ViewerEmbeddingsResponseSchema = z.object({
  data: z.array(EmbeddingPointSchema),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types — use these instead of hand-written interfaces
// ---------------------------------------------------------------------------

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
export type ChunkSummary = z.infer<typeof ChunkSummarySchema>;
export type ChunkDetail = z.infer<typeof ChunkDetailSchema>;
export type ViewerGraphNode = z.infer<typeof GraphNodeSchema>;
export type ViewerGraphEdge = z.infer<typeof GraphEdgeSchema>;
export type ViewerSearchResult = z.infer<typeof ViewerSearchResultSchema>;
export type EmbeddingPoint = z.infer<typeof EmbeddingPointSchema>;

export type ViewerStatsResponse = z.infer<typeof ViewerStatsResponseSchema>;
export type ViewerChunksResponse = z.infer<typeof ViewerChunksResponseSchema>;
export type ViewerChunkDetailResponse = z.infer<typeof ViewerChunkDetailResponseSchema>;
export type ViewerSearchResponse = z.infer<typeof ViewerSearchResponseSchema>;
export type ViewerGraphResponse = z.infer<typeof ViewerGraphResponseSchema>;
export type ViewerEmbeddingsResponse = z.infer<typeof ViewerEmbeddingsResponseSchema>;
