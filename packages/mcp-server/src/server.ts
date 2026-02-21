import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  loadConfig,
  OllamaEmbeddingProvider,
  LanceDBStore,
  BM25Index,
  HybridSearch,
  DependencyGraph,
  ContextExpander,
  type CodeRAGConfig,
  type SearchResult,
  type GraphNode,
  type GraphEdge,
} from '@coderag/core';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { handleSearch } from './tools/search.js';
import { handleContext } from './tools/context.js';
import { handleStatus } from './tools/status.js';

export const MCP_SERVER_VERSION = '0.1.0';

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

  constructor(options: CodeRAGServerOptions) {
    this.rootDir = options.rootDir;

    this.server = new Server(
      { name: 'coderag', version: MCP_SERVER_VERSION },
      { capabilities: { tools: {} } },
    );

    this.registerHandlers();
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
          name: 'coderag_status',
          description:
            'Get the current status of the CodeRAG index, including total chunks, model info, configured languages, and health status.',
          inputSchema: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const safeArgs: Record<string, unknown> = args ?? {};

      switch (name) {
        case 'coderag_search':
          return handleSearch(safeArgs, this.hybridSearch);
        case 'coderag_context':
          return handleContext(
            safeArgs,
            this.hybridSearch,
            this.contextExpander,
          );
        case 'coderag_status':
          return handleStatus(this.store, this.config);
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

  /** Expose for testing. */
  getServer(): Server {
    return this.server;
  }
}
