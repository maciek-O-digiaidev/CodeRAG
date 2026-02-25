import { ok, err, type Result } from 'neverthrow';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from './config/config-parser.js';
import { OllamaEmbeddingProvider } from './embedding/ollama-embedding-provider.js';
import { OpenAICompatibleEmbeddingProvider } from './embedding/openai-compatible-embedding-provider.js';
import { LanceDBStore } from './embedding/lancedb-store.js';
import { BM25Index } from './embedding/bm25-index.js';
import { HybridSearch } from './embedding/hybrid-search.js';
import { DependencyGraph } from './graph/dependency-graph.js';
import { ContextExpander, type ReadonlyGraph, type ChunkLookupFn } from './retrieval/context-expander.js';
import { CrossEncoderReRanker } from './retrieval/cross-encoder-reranker.js';
import type { ReRanker, EmbeddingProvider } from './types/provider.js';
import type { CodeRAGConfig } from './types/config.js';
import type { SearchResult } from './types/search.js';
import type { ChunkMetadata } from './types/chunk.js';
import type { GraphNode, GraphEdge } from './graph/dependency-graph.js';
import { safeString, safeStringUnion } from './utils/safe-cast.js';

/** All services needed at query time, initialized and ready. */
export interface CodeRAGRuntime {
  readonly config: CodeRAGConfig;
  readonly store: LanceDBStore;
  readonly hybridSearch: HybridSearch;
  readonly contextExpander: ContextExpander | null;
  readonly reranker: ReRanker | null;
  readonly graph: ReadonlyGraph;
  /** Shut down all connections (LanceDB, etc.). */
  close(): void;
}

export interface RuntimeOptions {
  /** Project root directory (must contain .coderag.yaml). */
  rootDir: string;
  /**
   * If true, skip context expander, reranker, and graph.
   * Useful for CLI search where only HybridSearch is needed.
   */
  searchOnly?: boolean;
}

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/**
 * Build a ChunkLookupFn that resolves chunk IDs via LanceDB.
 * Returns a SearchResult compatible with ContextExpander.
 */
function buildChunkLookup(store: LanceDBStore): ChunkLookupFn {
  return async (chunkId: string): Promise<SearchResult | undefined> => {
    const result = await store.getById(chunkId);
    if (result.isErr()) return undefined;

    const row = result.value;
    if (!row) return undefined;

    const meta = row.metadata;
    const CHUNK_TYPES = ['function', 'method', 'class', 'module', 'interface', 'type_alias', 'config_block', 'import_block', 'doc'] as const;
    const storedChunkType = safeStringUnion(meta['chunk_type'], CHUNK_TYPES, 'function');
    const storedName = safeString(meta['name'], '');
    const storedFilePath = safeString(meta['file_path'], '');
    const storedLanguage = safeString(meta['language'], 'unknown');
    const storedContent = safeString(meta['content'], '');
    const storedNlSummary = safeString(meta['nl_summary'], '');

    const chunkMetadata: ChunkMetadata = {
      chunkType: storedChunkType,
      name: storedName,
      declarations: [],
      imports: [],
      exports: [],
    };

    return {
      chunkId: row.id,
      content: storedContent,
      nlSummary: storedNlSummary,
      score: 0,
      method: 'hybrid',
      metadata: chunkMetadata,
      chunk: {
        id: row.id,
        content: storedContent,
        nlSummary: storedNlSummary,
        filePath: storedFilePath,
        startLine: 0,
        endLine: 0,
        language: storedLanguage,
        metadata: chunkMetadata,
      },
    };
  };
}

/**
 * Create an embedding provider from config.
 * Supports 'ollama' and 'openai-compatible' providers.
 * The 'auto' mode with lifecycle management is only used by the CLI index command.
 */
function createEmbeddingProvider(config: CodeRAGConfig): EmbeddingProvider {
  if (config.embedding.provider === 'openai-compatible' && config.embedding.openaiCompatible) {
    return new OpenAICompatibleEmbeddingProvider({
      baseUrl: config.embedding.openaiCompatible.baseUrl,
      model: config.embedding.model,
      dimensions: config.embedding.dimensions,
      apiKey: config.embedding.openaiCompatible.apiKey,
      maxBatchSize: config.embedding.openaiCompatible.maxBatchSize,
    });
  }

  // Default to Ollama (covers 'ollama', 'auto', and any other value)
  return new OllamaEmbeddingProvider({
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });
}

/**
 * Initialize a CodeRAGRuntime with all services wired together.
 *
 * Loads config, creates embedding provider, connects LanceDB, loads BM25 index,
 * builds HybridSearch, and optionally creates ContextExpander with a real
 * chunkLookup backed by LanceDB, re-ranker, and dependency graph.
 */
export async function createRuntime(
  options: RuntimeOptions,
): Promise<Result<CodeRAGRuntime, RuntimeError>> {
  const { rootDir, searchOnly = false } = options;

  // --- Load config ---
  const configResult = await loadConfig(rootDir);
  if (configResult.isErr()) {
    return err(new RuntimeError(`Config load failed: ${configResult.error.message}`));
  }
  const config = configResult.value;

  // --- Resolve + validate storage path ---
  const storagePath = resolve(rootDir, config.storage.path);
  if (!storagePath.startsWith(resolve(rootDir))) {
    return err(new RuntimeError('Storage path escapes project root'));
  }

  // --- Create embedding provider ---
  const embeddingProvider = createEmbeddingProvider(config);

  // --- Connect LanceDB ---
  const store = new LanceDBStore(storagePath, config.embedding.dimensions);
  try {
    await store.connect();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return err(new RuntimeError(`LanceDB connection failed: ${message}`));
  }

  // --- Load BM25 index ---
  let bm25Index = new BM25Index();
  const bm25Path = join(storagePath, 'bm25-index.json');
  try {
    const bm25Data = await readFile(bm25Path, 'utf-8');
    bm25Index = BM25Index.deserialize(bm25Data);
  } catch {
    // No saved BM25 index, start empty
  }

  // --- Create HybridSearch ---
  const hybridSearch = new HybridSearch(store, bm25Index, embeddingProvider, config.search);

  // --- Optional: graph, reranker, context expander ---
  let contextExpander: ContextExpander | null = null;
  let reranker: ReRanker | null = null;
  let graph: ReadonlyGraph = new DependencyGraph();

  if (!searchOnly) {
    // Load dependency graph
    const graphPath = join(storagePath, 'graph.json');
    try {
      const graphData = await readFile(graphPath, 'utf-8');
      const parsed: unknown = JSON.parse(graphData);
      if (parsed !== null && typeof parsed === 'object' && 'nodes' in parsed && 'edges' in parsed) {
        graph = DependencyGraph.fromJSON(parsed as { nodes: GraphNode[]; edges: GraphEdge[] });
      }
    } catch {
      // No saved graph, use empty
    }

    // Create re-ranker if enabled
    if (config.reranker?.enabled) {
      reranker = new CrossEncoderReRanker({
        model: config.reranker.model,
        topN: config.reranker.topN,
      });
    }

    // Create context expander with REAL chunk lookup
    const chunkLookup = buildChunkLookup(store);
    contextExpander = new ContextExpander(graph, chunkLookup);
  }

  return ok({
    config,
    store,
    hybridSearch,
    contextExpander,
    reranker,
    graph,
    close() {
      store.close();
    },
  });
}
