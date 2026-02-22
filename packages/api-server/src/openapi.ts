/**
 * OpenAPI 3.0 specification for the CodeRAG Cloud API.
 */
export interface OpenAPISpec {
  readonly openapi: string;
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly paths: Record<string, unknown>;
  readonly components: Record<string, unknown>;
}

export function createOpenAPISpec(): OpenAPISpec {
  return {
    openapi: '3.0.3',
    info: {
      title: 'CodeRAG Cloud API',
      version: '0.1.0',
      description:
        'REST API for CodeRAG — an intelligent codebase context engine for AI coding agents. ' +
        'Provides semantic search, context assembly, and index management over shared code indices.',
    },
    paths: {
      '/api/v1/search': {
        post: {
          summary: 'Search the codebase',
          description:
            'Search the indexed codebase using hybrid semantic + keyword search. ' +
            'Returns matching code chunks with file paths, types, content, and relevance scores.',
          operationId: 'searchCode',
          tags: ['Search'],
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['query'],
                  properties: {
                    query: {
                      type: 'string',
                      minLength: 1,
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
                      description: 'Filter by chunk type: function, method, class, module, interface, type_alias, config_block, import_block',
                    },
                    top_k: {
                      type: 'integer',
                      minimum: 1,
                      maximum: 100,
                      default: 10,
                      description: 'Maximum number of results to return',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Search results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      results: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/SearchResult' },
                      },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '503': { $ref: '#/components/responses/ServiceUnavailable' },
          },
        },
      },
      '/api/v1/context': {
        post: {
          summary: 'Get file context',
          description:
            'Assemble rich context for a specific file, including primary code chunks, ' +
            'related chunks from the dependency graph, and a dependency graph excerpt. Output is token-budgeted.',
          operationId: 'getContext',
          tags: ['Context'],
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['file_path'],
                  properties: {
                    file_path: {
                      type: 'string',
                      minLength: 1,
                      description: 'Target file path to get context for',
                    },
                    include_tests: {
                      type: 'boolean',
                      default: true,
                      description: 'Include test files in context',
                    },
                    include_interfaces: {
                      type: 'boolean',
                      default: true,
                      description: 'Include interface/type chunks in context',
                    },
                    max_tokens: {
                      type: 'integer',
                      minimum: 1,
                      maximum: 128000,
                      default: 8000,
                      description: 'Maximum token budget for assembled context',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Assembled context',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ContextResponse' },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '503': { $ref: '#/components/responses/ServiceUnavailable' },
          },
        },
      },
      '/api/v1/status': {
        get: {
          summary: 'Get index status',
          description: 'Get the current status of the CodeRAG index, including total chunks, model info, and health.',
          operationId: 'getStatus',
          tags: ['Status'],
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Index status',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StatusResponse' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
        },
      },
      '/api/v1/index': {
        post: {
          summary: 'Trigger re-indexing (admin)',
          description: 'Trigger re-indexing of the codebase. Requires admin API key.',
          operationId: 'triggerIndex',
          tags: ['Admin'],
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    root_dir: {
                      type: 'string',
                      description: 'Root directory to index (uses server default if omitted)',
                    },
                    force: {
                      type: 'boolean',
                      default: false,
                      description: 'Force full re-index even if files are unchanged',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Indexing result',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/IndexResponse' },
                },
              },
            },
            '400': { $ref: '#/components/responses/ValidationError' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '503': { $ref: '#/components/responses/ServiceUnavailable' },
          },
        },
      },
      '/health': {
        get: {
          summary: 'Health check',
          description: 'Simple health check endpoint. No authentication required.',
          operationId: 'healthCheck',
          tags: ['Health'],
          responses: {
            '200': {
              description: 'Server is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['ok'] },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key passed as Bearer token in the Authorization header',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key passed in the X-API-Key header',
        },
      },
      schemas: {
        SearchResult: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            chunk_type: { type: 'string' },
            name: { type: 'string' },
            content: { type: 'string' },
            nl_summary: { type: 'string' },
            score: { type: 'number' },
          },
        },
        ContextResponse: {
          type: 'object',
          properties: {
            context: { type: 'string' },
            token_count: { type: 'integer' },
            truncated: { type: 'boolean' },
            primary_chunks: { type: 'integer' },
            related_chunks: { type: 'integer' },
          },
        },
        StatusResponse: {
          type: 'object',
          properties: {
            total_chunks: { type: 'integer' },
            last_indexed: { type: 'string', nullable: true },
            model: { type: 'string' },
            languages: {
              oneOf: [
                { type: 'array', items: { type: 'string' } },
                { type: 'string', enum: ['auto'] },
              ],
            },
            health: {
              type: 'string',
              enum: ['ok', 'degraded', 'not_initialized'],
            },
          },
        },
        IndexResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['completed'] },
            indexed_files: { type: 'integer' },
            duration_ms: { type: 'integer' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
      responses: {
        ValidationError: {
          description: 'Request validation error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                  details: { type: 'array', items: { type: 'object' } },
                },
              },
            },
          },
        },
        Unauthorized: {
          description: 'Missing or invalid API key',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        Forbidden: {
          description: 'Insufficient permissions (admin required)',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        RateLimited: {
          description: 'Rate limit exceeded',
          headers: {
            'Retry-After': {
              description: 'Seconds until the rate limit resets',
              schema: { type: 'integer' },
            },
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                  message: { type: 'string' },
                  retry_after: { type: 'integer' },
                },
              },
            },
          },
        },
        ServiceUnavailable: {
          description: 'Service not initialized',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
    },
  };
}
