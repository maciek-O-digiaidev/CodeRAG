import express, { type Express } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import {
  loadConfig,
  OllamaEmbeddingProvider,
  LanceDBStore,
  BM25Index,
  HybridSearch,
  DependencyGraph,
  ContextExpander,
  CrossEncoderReRanker,
  type ReRanker,
  type CodeRAGConfig,
  type SearchResult,
  type GraphNode,
  type GraphEdge,
} from '@coderag/core';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseApiKeys, createAuthMiddleware, type ApiKeyEntry, type AuthenticatedRequest } from './middleware/auth.js';
import { createRateLimitMiddleware, parseRateLimitConfig } from './middleware/rate-limit.js';
import { createSearchRouter } from './routes/search.js';
import { createContextRouter } from './routes/context.js';
import { createStatusRouter } from './routes/status.js';
import { createIndexTriggerRouter, type IndexTriggerCallback } from './routes/index-trigger.js';
import { createTeamRouter, createTeamState } from './routes/team.js';
import { createHistoryRouter, HistoryStore } from './routes/history.js';
import { createOpenAPISpec } from './openapi.js';
import { DashboardDataCollector } from './dashboard/data-collector.js';
import { createDashboardRouter } from './dashboard/routes.js';
import { createViewerRouter } from './routes/viewer.js';

export const API_SERVER_VERSION = '0.1.0';

export interface ApiServerOptions {
  /** Root directory of the project to index. */
  readonly rootDir: string;
  /** Port to listen on. Default: 3100 */
  readonly port: number;
  /** Parsed API keys. If not provided, reads from CODERAG_API_KEYS env var. */
  readonly apiKeys?: ReadonlyArray<ApiKeyEntry>;
  /** Custom index trigger callback. */
  readonly onIndex?: IndexTriggerCallback | null;
  /** CORS origin. Default: '*' */
  readonly corsOrigin?: string;
}

export class ApiServer {
  private readonly app: Express;
  private readonly rootDir: string;
  private readonly port: number;
  private httpServer: HttpServer | null = null;

  // Core services (populated after initialize())
  private config: CodeRAGConfig | null = null;
  private store: LanceDBStore | null = null;
  private hybridSearch: HybridSearch | null = null;
  private contextExpander: ContextExpander | null = null;
  private reranker: ReRanker | null = null;
  private graph: DependencyGraph | null = null;

  // Dashboard data collector
  private readonly dataCollector: DashboardDataCollector;

  constructor(options: ApiServerOptions) {
    this.rootDir = options.rootDir;
    this.port = options.port;

    const apiKeys = options.apiKeys ?? parseApiKeys(process.env['CODERAG_API_KEYS']);
    const rateLimitConfig = parseRateLimitConfig(process.env);
    const corsOrigin = options.corsOrigin ?? '*';

    this.app = express();

    // --- Global Middleware ---

    // CORS
    this.app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      if (_req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    // JSON body parser
    this.app.use(express.json());

    // --- Unauthenticated Routes ---

    // Health check (no auth required)
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // OpenAPI spec (no auth required)
    this.app.get('/api/openapi.json', (_req, res) => {
      res.json(createOpenAPISpec());
    });

    // --- Authenticated Routes ---

    // Auth middleware
    this.app.use('/api/v1', createAuthMiddleware(apiKeys));

    // Rate limiting (after auth so we can track per-key)
    this.app.use('/api/v1', createRateLimitMiddleware(rateLimitConfig));

    // Mount routes (deps are mutable references resolved at request time)
    const searchDeps = {
      get hybridSearch() { return self.hybridSearch; },
      get reranker() { return self.reranker; },
    };
    const contextDeps = {
      get hybridSearch() { return self.hybridSearch; },
      get contextExpander() { return self.contextExpander; },
    };
    const statusDeps = {
      get store() { return self.store; },
      get config() { return self.config; },
    };
    const indexDeps = {
      onIndex: options.onIndex ?? null,
    };

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.app.use('/api/v1/search', createSearchRouter(searchDeps));
    this.app.use('/api/v1/context', createContextRouter(contextDeps));
    this.app.use('/api/v1/status', createStatusRouter(statusDeps));
    this.app.use('/api/v1/index', createIndexTriggerRouter(indexDeps));

    // Team shared context routes
    const teamState = createTeamState();
    this.app.use('/api/v1/team', createTeamRouter({
      storageProvider: null,
      teamState,
    }));

    // History and bookmarks routes
    const historyStore = new HistoryStore();
    this.app.use('/api/v1', createHistoryRouter({ historyStore }));

    // Viewer routes (read-only visualization API)
    this.app.use('/api/v1/viewer', createViewerRouter({
      getStore: () => self.store,
      getConfig: () => self.config,
      getHybridSearch: () => self.hybridSearch,
      getGraph: () => self.graph,
    }));

    // --- Dashboard ---

    this.dataCollector = new DashboardDataCollector({
      getStore: () => self.store,
      getConfig: () => self.config,
      apiKeys,
    });

    // Request tracking middleware (all routes)
    this.app.use((req, _res, next) => {
      const authReq = req as AuthenticatedRequest;
      this.dataCollector.recordRequest(
        req.method,
        req.path,
        authReq.apiKey?.key ?? null,
      );
      next();
    });

    // Mount dashboard (admin-only, handles its own auth)
    this.app.use('/dashboard', createDashboardRouter({
      dataCollector: this.dataCollector,
      onIndex: options.onIndex ?? null,
      getConfig: () => self.config,
      apiKeys,
    }));
  }

  /**
   * Initialize all core services: load config, connect LanceDB, build indices.
   * The server still starts even if initialization errors occur.
   */
  async initialize(): Promise<void> {
    try {
      const configResult = await loadConfig(this.rootDir);
      if (configResult.isErr()) {
        // eslint-disable-next-line no-console
        console.error(`[api-server] Config load failed: ${configResult.error.message}`);
        return;
      }

      this.config = configResult.value;

      // Create embedding provider
      const embeddingProvider = new OllamaEmbeddingProvider({
        model: this.config.embedding.model,
        dimensions: this.config.embedding.dimensions,
      });

      // Create LanceDB store
      const storagePath = resolve(this.rootDir, this.config.storage.path);
      if (!storagePath.startsWith(resolve(this.rootDir))) {
        // eslint-disable-next-line no-console
        console.error('[api-server] Storage path escapes project root');
        return;
      }
      this.store = new LanceDBStore(storagePath, this.config.embedding.dimensions);
      await this.store.connect();

      // Load BM25 index
      let bm25Index = new BM25Index();
      const bm25Path = join(storagePath, 'bm25-index.json');
      try {
        const bm25Data = await readFile(bm25Path, 'utf-8');
        bm25Index = BM25Index.deserialize(bm25Data);
      } catch {
        // No saved BM25 index, start empty
      }

      // Create HybridSearch
      this.hybridSearch = new HybridSearch(
        this.store,
        bm25Index,
        embeddingProvider,
        this.config.search,
      );

      // Create re-ranker if enabled
      if (this.config.reranker?.enabled) {
        this.reranker = new CrossEncoderReRanker({
          model: this.config.reranker.model,
          topN: this.config.reranker.topN,
        });
      }

      // Load dependency graph
      let graph = new DependencyGraph();
      const graphPath = join(storagePath, 'graph.json');
      try {
        const graphData = await readFile(graphPath, 'utf-8');
        const parsed = JSON.parse(graphData) as { nodes: GraphNode[]; edges: GraphEdge[] };
        graph = DependencyGraph.fromJSON(parsed);
      } catch {
        // No saved graph, start empty
      }

      // Store graph for viewer API
      this.graph = graph;

      // Create context expander
      const chunkLookup = (_chunkId: string): SearchResult | undefined => undefined;
      this.contextExpander = new ContextExpander(graph, chunkLookup);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // eslint-disable-next-line no-console
      console.error(`[api-server] Initialization failed: ${message}`);
    }
  }

  /**
   * Start listening on the configured port.
   */
  async start(): Promise<void> {
    this.httpServer = createServer(this.app);

    return new Promise<void>((resolvePromise, reject) => {
      this.httpServer!.on('error', reject);
      this.httpServer!.listen(this.port, () => {
        resolvePromise();
      });
    });
  }

  /**
   * Gracefully shut down the HTTP server.
   */
  async close(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolvePromise, reject) => {
        this.httpServer!.close((closeErr) => {
          if (closeErr) reject(closeErr);
          else resolvePromise();
        });
      });
      this.httpServer = null;
    }
  }

  /** Expose Express app for testing with supertest. */
  getApp(): Express {
    return this.app;
  }
}
