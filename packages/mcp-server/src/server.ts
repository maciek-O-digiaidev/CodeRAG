import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  loadConfig,
  checkIndexExists,
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
  type BacklogProvider,
  type IndexCheckResult,
} from '@code-rag/core';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { handleSearch } from './tools/search.js';
import { handleContext } from './tools/context.js';
import { handleStatus } from './tools/status.js';
import { handleExplain } from './tools/explain.js';
import { handleBacklog } from './tools/backlog.js';
import { handleDocs } from './tools/docs.js';

export const MCP_SERVER_VERSION = '0.1.0';

/** Message printed when the CLI `serve` command cannot find an index. */
export const NO_INDEX_MESSAGE = `CodeRAG: No index found for this project.

To build the RAG index, run:
  npx coderag index

Or in VS Code, use the command:
  CodeRAG: Index

The MCP server will start automatically once indexing is complete.`;

export interface CodeRAGServerOptions {
  rootDir: string;
}

export class CodeRAGServer {
  private readonly server: Server;
  private readonly rootDir: string;
  private config: CodeRAGConfig | null = null;
  private store: LanceDBStore | null = null;
  private hybridSearch: HybridSearch | null = null;
  private contextExpander: ContextExpander | null = null;
  private reranker: ReRanker | null = null;
  private backlogProvider: BacklogProvider | null = null;
  private httpServer: HttpServer | null = null;
  private transports: Map<string, SSEServerTransport> = new Map();
  private indexCheck: IndexCheckResult = { exists: false, empty: false };

  constructor(options: CodeRAGServerOptions) {
    this.rootDir = options.rootDir;

    this.server = new Server(
      { name: 'coderag', version: MCP_SERVER_VERSION },
      { capabilities: { tools: {} } },
    );

    this.registerHandlers();
  }

  /**
   * Check whether a RAG index exists for the project.
   * Loads config to determine storage path, then checks for LanceDB + BM25 data.
   * Returns the index check result, or null if config could not be loaded.
   */
  async checkIndex(): Promise<IndexCheckResult | null> {
    const configResult = await loadConfig(this.rootDir);
    if (configResult.isErr()) {
      return null;
    }

    const config = configResult.value;
    const storagePath = resolve(this.rootDir, config.storage.path);
    if (!storagePath.startsWith(resolve(this.rootDir))) {
      return null;
    }

    return checkIndexExists(storagePath);
  }

  /** Get the current index check result (set during initialize). */
  getIndexCheck(): IndexCheckResult {
    return this.indexCheck;
  }

  /**
   * Initialize all services: load config, connect LanceDB, build indices.
   * Fails gracefully -- the server still starts even if initialization errors occur.
   */
  async initialize(): Promise<void> {
    try {
      const configResult = await loadConfig(this.rootDir);
      if (configResult.isErr()) {
        // eslint-disable-next-line no-console
        console.error(`[coderag] Config load failed: ${configResult.error.message}`);
        return;
      }

      this.config = configResult.value;

      // Create embedding provider
      const embeddingProvider = new OllamaEmbeddingProvider({
        model: this.config.embedding.model,
        dimensions: this.config.embedding.dimensions,
      });

      // Create LanceDB store (validate path stays within rootDir)
      const storagePath = resolve(this.rootDir, this.config.storage.path);
      if (!storagePath.startsWith(resolve(this.rootDir))) {
        // eslint-disable-next-line no-console
        console.error('[coderag] Storage path escapes project root');
        return;
      }

      // Check index existence before connecting
      this.indexCheck = await checkIndexExists(storagePath);

      this.store = new LanceDBStore(storagePath, this.config.embedding.dimensions);
      await this.store.connect();

      // Create BM25 index -- try to load from stored data
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

      // Load dependency graph if available
      let graph = new DependencyGraph();
      const graphPath = join(storagePath, 'graph.json');
      try {
        const graphData = await readFile(graphPath, 'utf-8');
        const parsed = JSON.parse(graphData) as { nodes: GraphNode[]; edges: GraphEdge[] };
        graph = DependencyGraph.fromJSON(parsed);
      } catch {
        // No saved graph, start empty
      }

      // Create retrieval services
      const chunkLookup = (_chunkId: string): SearchResult | undefined => {
        // In a full implementation this would look up chunks by ID.
        // For now, the context expander will only work with chunks found via search.
        return undefined;
      };

      this.contextExpander = new ContextExpander(graph, chunkLookup);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // eslint-disable-next-line no-console
      console.error(`[coderag] Initialization failed: ${message}`);
    }
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'coderag_search',
          description:
            'Search the indexed codebase using hybrid semantic + keyword search. Returns matching code chunks with file paths, types, content, and relevance scores.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              query: {
                type: 'string',
                description: 'Natural language search query',
              },
              language: {
                type: 'string',
                description: 'Filter results by programming language (e.g. "typescript", "python")',
              },
              file_path: {
                type: 'string',
                description: 'Filter results by file path substring',
              },
              chunk_type: {
                type: 'string',
                description:
                  'Filter by chunk type: function, method, class, module, interface, type_alias, config_block, import_block',
              },
              top_k: {
                type: 'number',
                description: 'Maximum number of results to return (default: 10)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'coderag_context',
          description:
            'Assemble rich context for a specific file, including primary code chunks, related chunks from the dependency graph, and a dependency graph excerpt. Output is token-budgeted.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              file_path: {
                type: 'string',
                description: 'Target file path to get context for',
              },
              include_tests: {
                type: 'boolean',
                description: 'Include test files in context (default: true)',
              },
              include_interfaces: {
                type: 'boolean',
                description: 'Include interface/type chunks in context (default: true)',
              },
              max_tokens: {
                type: 'number',
                description: 'Maximum token budget for assembled context (default: 8000)',
              },
            },
            required: ['file_path'],
          },
        },
        {
          name: 'coderag_explain',
          description:
            'Get a detailed natural language explanation of a code module, function, or class. Returns NL summaries, code content, and related symbols. At least one of file_path or name must be provided.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              file_path: {
                type: 'string',
                description: 'File path to explain',
              },
              name: {
                type: 'string',
                description: 'Function, class, or method name to search for and explain',
              },
              detail_level: {
                type: 'string',
                enum: ['brief', 'detailed'],
                description: 'Level of detail: "brief" for summaries only, "detailed" for full code + dependencies (default: "detailed")',
              },
            },
            required: [],
          },
        },
        {
          name: 'coderag_status',
          description:
            'Get the current status of the CodeRAG index, including total chunks, model info, configured languages, and health status.',
          inputSchema: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
        {
          name: 'coderag_backlog',
          description:
            'Query project backlog items linked to code. Supports searching by text, retrieving by ID, and listing with filters for type, state, and tags.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              action: {
                type: 'string',
                enum: ['search', 'get', 'list'],
                description: 'Action to perform: "search" to find items by text, "get" to retrieve a single item by ID, "list" to list items with filters',
              },
              query: {
                type: 'string',
                description: 'Search text (required for "search" action)',
              },
              id: {
                type: 'string',
                description: 'Item ID (required for "get" action)',
              },
              types: {
                type: 'array',
                items: { type: 'string', enum: ['epic', 'story', 'task', 'bug', 'feature'] },
                description: 'Filter by backlog item types',
              },
              states: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by item states (e.g. "New", "Active", "Resolved")',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 10, max: 50)',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'coderag_docs',
          description:
            'Search project documentation (Markdown, Confluence, etc.) for relevant sections.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              query: {
                type: 'string',
                description: 'Natural language search query for documentation',
              },
              source: {
                type: 'string',
                enum: ['markdown', 'confluence', 'all'],
                description: 'Filter by documentation source: "markdown" for local .md files, "confluence" for Confluence pages, "all" for everything (default: "all")',
              },
              file_path: {
                type: 'string',
                description: 'Filter results by file path substring',
              },
              top_k: {
                type: 'number',
                description: 'Maximum number of results to return (default: 10)',
              },
            },
            required: ['query'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const safeArgs: Record<string, unknown> = args ?? {};

      switch (name) {
        case 'coderag_search':
          return handleSearch(safeArgs, this.hybridSearch, this.reranker);
        case 'coderag_context':
          return handleContext(
            safeArgs,
            this.hybridSearch,
            this.contextExpander,
          );
        case 'coderag_explain':
          return handleExplain(
            safeArgs,
            this.hybridSearch,
            this.contextExpander,
          );
        case 'coderag_status':
          return handleStatus(this.store, this.config);
        case 'coderag_backlog':
          return handleBacklog(safeArgs, this.backlogProvider);
        case 'coderag_docs':
          return handleDocs(safeArgs, this.hybridSearch, this.reranker);
        default:
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `Unknown tool: ${name}` }),
              },
            ],
          };
      }
    });
  }

  async connectStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Start the MCP server with SSE transport on the given port.
   *
   * - GET  /sse       — establishes the SSE stream
   * - POST /messages  — receives JSON-RPC messages from the client
   *
   * Returns a promise that resolves once the HTTP server is listening.
   */
  async connectSSE(port: number): Promise<void> {
    const setCorsHeaders = (res: ServerResponse): void => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    };

    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      setCorsHeaders(res);

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }

      const parsedUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
      const pathname = parsedUrl.pathname;

      if (req.method === 'GET' && pathname === '/sse') {
        // Close any existing connections — SSEServerTransport is single-client.
        // This handles VS Code extension reloads gracefully.
        for (const [id, old] of this.transports) {
          await old.close();
          this.transports.delete(id);
        }
        await this.server.close();

        const transport = new SSEServerTransport('/messages', res);
        this.transports.set(transport.sessionId, transport);

        res.on('close', () => {
          this.transports.delete(transport.sessionId);
        });

        await this.server.connect(transport);
        return;
      }

      if (req.method === 'POST' && pathname === '/messages') {
        const sessionId = parsedUrl.searchParams.get('sessionId');
        if (!sessionId) {
          res.writeHead(400).end('Missing sessionId');
          return;
        }

        const transport = this.transports.get(sessionId);
        if (!transport) {
          res.writeHead(400).end('No transport found for sessionId');
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      // Unknown route
      res.writeHead(404).end('Not Found');
    });

    return new Promise<void>((resolvePromise, reject) => {
      this.httpServer!.on('error', reject);
      this.httpServer!.listen(port, () => {
        resolvePromise();
      });
    });
  }

  /**
   * Gracefully shut down the HTTP server (if running) and close all SSE transports.
   */
  async close(): Promise<void> {
    // Close all active transports
    for (const [sessionId, transport] of this.transports) {
      await transport.close();
      this.transports.delete(sessionId);
    }

    if (this.httpServer) {
      await new Promise<void>((resolvePromise, reject) => {
        this.httpServer!.close((err) => {
          if (err) reject(err);
          else resolvePromise();
        });
      });
      this.httpServer = null;
    }
  }

  /** Expose for testing. */
  getServer(): Server {
    return this.server;
  }
}
