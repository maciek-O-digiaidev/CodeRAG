import { Router } from 'express';
import { z } from 'zod';
import type {
  LanceDBStore,
  CodeRAGConfig,
  HybridSearch,
  DependencyGraph,
  GraphNode,
  GraphEdge,
} from '@coderag/core';

// --- Zod schemas for query parameter validation ---

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

const chunkFiltersSchema = paginationSchema.extend({
  language: z.string().optional(),
  type: z.string().optional(),
  file: z.string().optional(),
  q: z.string().optional(),
});

const chunkDetailSchema = z.object({
  includeVector: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

const graphFiltersSchema = z.object({
  file: z.string().optional(),
  type: z.string().optional(),
  maxNodes: z.coerce.number().int().positive().max(5000).default(500),
});

const searchQuerySchema = z.object({
  q: z.string().min(1, 'q query parameter is required'),
  topK: z.coerce.number().int().positive().max(100).default(10),
  vectorWeight: z.coerce.number().min(0).max(1).optional(),
  bm25Weight: z.coerce.number().min(0).max(1).optional(),
});

const embeddingsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(2000).default(500),
});

// --- Response types ---

export interface ViewerStatsResponse {
  data: {
    chunkCount: number;
    fileCount: number;
    languages: Record<string, number>;
    storageBytes: number | null;
    lastIndexed: string | null;
  };
}

export interface ChunkSummary {
  id: string;
  filePath: string;
  chunkType: string;
  name: string;
  language: string;
  startLine: number;
  endLine: number;
  contentPreview: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ChunkDetail {
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
}

export interface GraphResponse {
  data: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
}

export interface ViewerSearchResult {
  chunkId: string;
  filePath: string;
  chunkType: string;
  name: string;
  content: string;
  nlSummary: string;
  score: number;
  method: string;
}

export interface ViewerSearchResponse {
  data: {
    results: ViewerSearchResult[];
    timing: {
      totalMs: number;
    };
  };
}

export interface EmbeddingPoint {
  id: string;
  filePath: string;
  chunkType: string;
  language: string;
  vector: number[];
}

// --- Dependencies interface ---

export interface ViewerDeps {
  readonly getStore: () => LanceDBStore | null;
  readonly getConfig: () => CodeRAGConfig | null;
  readonly getHybridSearch: () => HybridSearch | null;
  readonly getGraph: () => DependencyGraph | null;
}

// --- Router factory ---

export function createViewerRouter(deps: ViewerDeps): Router {
  const router = Router();

  // GET /stats — Index statistics
  router.get('/stats', async (_req, res) => {
    const store = deps.getStore();

    if (!store) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    try {
      const table = getInternalTable(store);

      if (!table) {
        res.json({
          data: {
            chunkCount: 0,
            fileCount: 0,
            languages: {},
            storageBytes: null,
            lastIndexed: null,
          },
        } satisfies ViewerStatsResponse);
        return;
      }

      const allRows = await table.query().toArray() as LanceDBRow[];
      const chunkCount = allRows.length;

      // Compute unique file paths and language counts from actual data
      const filePaths = new Set<string>();
      const languageCounts: Record<string, number> = {};
      for (const row of allRows) {
        if (row.file_path) filePaths.add(row.file_path);
        if (row.language) {
          languageCounts[row.language] = (languageCounts[row.language] ?? 0) + 1;
        }
      }

      // Read lastIndexed from index-state.json if available
      // Format: { "path/to/file": { filePath, contentHash, lastIndexedAt, chunkIds }, ... }
      let lastIndexed: string | null = null;
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const storagePath = (store as unknown as { storagePath: string }).storagePath;
        const statePath = path.join(storagePath, 'index-state.json');
        if (fs.existsSync(statePath)) {
          const stateJson = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Record<string, { lastIndexedAt?: string }>;
          let latest = '';
          for (const entry of Object.values(stateJson)) {
            if (entry.lastIndexedAt && entry.lastIndexedAt > latest) {
              latest = entry.lastIndexedAt;
            }
          }
          if (latest) lastIndexed = latest;
        }
      } catch {
        // Ignore — lastIndexed stays null
      }

      const response: ViewerStatsResponse = {
        data: {
          chunkCount,
          fileCount: filePaths.size,
          languages: languageCounts,
          storageBytes: null,
          lastIndexed,
        },
      };

      res.json(response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Internal Server Error', message });
    }
  });

  // GET /chunks — Paginated chunk listing
  router.get('/chunks', async (req, res) => {
    const store = deps.getStore();

    if (!store) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const parsed = chunkFiltersSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    try {
      const { page, pageSize, language, type, file, q } = parsed.data;

      const table = getInternalTable(store);

      if (!table) {
        res.json({
          data: [],
          meta: { page, pageSize, total: 0, totalPages: 0 } satisfies PaginationMeta,
        });
        return;
      }

      const allRows = await table.query().toArray() as LanceDBRow[];

      // Apply filters
      let filtered = allRows;

      if (language) {
        const lang = language.toLowerCase();
        filtered = filtered.filter((row) => row.language.toLowerCase() === lang);
      }

      if (type) {
        filtered = filtered.filter((row) => row.chunk_type === type);
      }

      if (file) {
        filtered = filtered.filter((row) => row.file_path.includes(file));
      }

      if (q) {
        const queryLower = q.toLowerCase();
        filtered = filtered.filter(
          (row) =>
            row.content.toLowerCase().includes(queryLower) ||
            row.nl_summary.toLowerCase().includes(queryLower) ||
            row.id.toLowerCase().includes(queryLower),
        );
      }

      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;
      const pageRows = filtered.slice(offset, offset + pageSize);

      const data: ChunkSummary[] = pageRows.map((row) => {
        let parsedMeta: Record<string, unknown> = {};
        try {
          parsedMeta = JSON.parse(row.metadata) as Record<string, unknown>;
        } catch {
          // Ignore parse errors
        }

        return {
          id: row.id,
          filePath: row.file_path,
          chunkType: row.chunk_type,
          name: (parsedMeta['name'] as string | undefined) ?? '',
          language: row.language,
          startLine: (parsedMeta['start_line'] as number | undefined) ?? 0,
          endLine: (parsedMeta['end_line'] as number | undefined) ?? 0,
          contentPreview: row.content.substring(0, 200),
        };
      });

      res.json({
        data,
        meta: { page, pageSize, total, totalPages } satisfies PaginationMeta,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Internal Server Error', message });
    }
  });

  // GET /chunks/:id — Single chunk detail
  router.get('/chunks/:id', async (req, res) => {
    const store = deps.getStore();

    if (!store) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const parsedQuery = chunkDetailSchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsedQuery.error.issues,
      });
      return;
    }

    const chunkId = req.params['id'];
    if (!chunkId) {
      res.status(400).json({ error: 'Chunk ID is required' });
      return;
    }

    try {
      const table = getInternalTable(store);

      if (!table) {
        res.status(404).json({ error: 'Chunk not found' });
        return;
      }

      const allRows = await table.query().toArray() as LanceDBRow[];
      const row = allRows.find((r) => r.id === chunkId);

      if (!row) {
        res.status(404).json({ error: 'Chunk not found' });
        return;
      }

      let parsedMeta: Record<string, unknown> = {};
      try {
        parsedMeta = JSON.parse(row.metadata) as Record<string, unknown>;
      } catch {
        // Ignore parse errors
      }

      const detail: ChunkDetail = {
        id: row.id,
        filePath: row.file_path,
        chunkType: row.chunk_type,
        name: (parsedMeta['name'] as string | undefined) ?? '',
        language: row.language,
        startLine: (parsedMeta['start_line'] as number | undefined) ?? 0,
        endLine: (parsedMeta['end_line'] as number | undefined) ?? 0,
        content: row.content,
        nlSummary: row.nl_summary,
        metadata: parsedMeta,
      };

      if (parsedQuery.data.includeVector && row.vector) {
        detail.vector = row.vector;
      }

      res.json({ data: detail });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Internal Server Error', message });
    }
  });

  // GET /graph — Dependency graph nodes and edges
  router.get('/graph', (_req, res) => {
    const graph = deps.getGraph();

    if (!graph) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const parsed = graphFiltersSchema.safeParse(_req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    try {
      const { file, type, maxNodes } = parsed.data;

      let nodes = graph.getAllNodes();
      let edges = graph.getAllEdges();

      // Apply filters
      if (file) {
        nodes = nodes.filter((n) => n.filePath.includes(file));
      }

      if (type) {
        nodes = nodes.filter((n) => n.type === type);
      }

      // Limit nodes
      nodes = nodes.slice(0, maxNodes);

      // Filter edges to only include those between included nodes
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

      const response: GraphResponse = {
        data: { nodes, edges },
      };

      res.json(response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Internal Server Error', message });
    }
  });

  // GET /search — Search with score breakdown
  router.get('/search', async (req, res) => {
    const hybridSearch = deps.getHybridSearch();

    if (!hybridSearch) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    try {
      const { q, topK, vectorWeight, bm25Weight } = parsed.data;

      const startTime = performance.now();
      const searchResult = await hybridSearch.search(q, {
        topK,
        vectorWeight,
        bm25Weight,
      });
      const totalMs = Math.round(performance.now() - startTime);

      if (searchResult.isErr()) {
        res.status(500).json({
          error: 'Search Failed',
          message: searchResult.error.message,
        });
        return;
      }

      const results: ViewerSearchResult[] = searchResult.value.map((r) => ({
        chunkId: r.chunkId,
        filePath: r.chunk?.filePath ?? '',
        chunkType: r.metadata.chunkType,
        name: r.metadata.name,
        content: r.content,
        nlSummary: r.nlSummary,
        score: r.score,
        method: r.method,
      }));

      const response: ViewerSearchResponse = {
        data: {
          results,
          timing: { totalMs },
        },
      };

      res.json(response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Internal Server Error', message });
    }
  });

  // GET /embeddings — Raw embedding vectors for visualization
  router.get('/embeddings', async (req, res) => {
    const store = deps.getStore();

    if (!store) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const parsed = embeddingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    try {
      const { limit } = parsed.data;

      const table = getInternalTable(store);

      if (!table) {
        res.json({ data: [] });
        return;
      }

      const allRows = await table.query().toArray() as LanceDBRow[];
      const limitedRows = allRows.slice(0, limit);

      const data: EmbeddingPoint[] = limitedRows.map((row) => ({
        id: row.id,
        filePath: row.file_path,
        chunkType: row.chunk_type,
        language: row.language,
        vector: row.vector,
      }));

      res.json({ data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Internal Server Error', message });
    }
  });

  return router;
}

// Internal type to match LanceDB row shape (used for type-safe casting)
interface LanceDBRow {
  id: string;
  vector: number[];
  content: string;
  nl_summary: string;
  chunk_type: string;
  file_path: string;
  language: string;
  metadata: string;
}

// Helper to access internal LanceDB table for direct queries (viewer-only pattern).
// LanceDB Table does not expose .toArray() directly; use .query().toArray() instead.
function getInternalTable(
  store: LanceDBStore,
): { query: () => { toArray: () => Promise<LanceDBRow[]> } } | null {
  const internal = store as unknown as {
    table: { query: () => { toArray: () => Promise<LanceDBRow[]> } } | null;
  };
  return internal.table;
}
