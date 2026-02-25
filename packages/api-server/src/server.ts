import express, { type Express } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import {
  createRuntime,
  DependencyGraph,
  type CodeRAGRuntime,
  type CodeRAGConfig,
  type LanceDBStore,
  type HybridSearch,
  type ContextExpander,
  type ReRanker,
} from '@code-rag/core';
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
  private runtime: CodeRAGRuntime | null = null;
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
      const runtimeResult = await createRuntime({ rootDir: this.rootDir });
      if (runtimeResult.isErr()) {
        // eslint-disable-next-line no-console
        console.error(`[api-server] ${runtimeResult.error.message}`);
        return;
      }

      this.runtime = runtimeResult.value;
      this.config = this.runtime.config;
      this.store = this.runtime.store;
      this.hybridSearch = this.runtime.hybridSearch;
      this.contextExpander = this.runtime.contextExpander;
      this.reranker = this.runtime.reranker;

      // Expose graph as DependencyGraph for viewer API (getAllNodes, getAllEdges)
      const graphInstance = this.runtime.graph;
      if (graphInstance instanceof DependencyGraph) {
        this.graph = graphInstance;
      }
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

    // Close the runtime (LanceDB, etc.)
    if (this.runtime) {
      this.runtime.close();
      this.runtime = null;
    }
  }

  /** Expose Express app for testing with supertest. */
  getApp(): Express {
    return this.app;
  }
}
