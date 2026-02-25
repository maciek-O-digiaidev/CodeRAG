---
tags:
  - api-reference
  - rest-api
  - api-server
  - http
aliases:
  - REST API
  - HTTP API
  - API Server Reference
---

# REST API Reference

The CodeRAG [API Server](../packages/api-server.md) exposes a RESTful HTTP API for search, context assembly, indexing, team collaboration, and administration. The server is built with Express and listens on port `3100` by default.

> **Note: > All `/api/v1/*` endpoints require authentication via API key (header `X-API-Key` or `Authorization: Bearer <key>`). Keys are configured via the `CODERAG_API_KEYS` environment variable.**

---

## Health

### GET /health

Health check endpoint. No authentication required.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-23T10:00:00.000Z"
}
```

```bash
curl http://localhost:3100/health
```

### GET /api/openapi.json

Returns the OpenAPI 3.0 specification for the API. No authentication required.

```bash
curl http://localhost:3100/api/openapi.json
```

---

## Search & Context

### POST /api/v1/search

Performs hybrid semantic + keyword search across the codebase index. Requires authentication.

**Request Body:**

| Field        | Type     | Required | Default | Description                                        |
| ------------ | -------- | -------- | ------- | -------------------------------------------------- |
| `query`      | `string` | Yes      | --      | Search query (min 1 char)                          |
| `language`   | `string` | No       | --      | Filter by programming language                     |
| `file_path`  | `string` | No       | --      | Filter by file path substring (no `..` allowed)    |
| `chunk_type` | `string` | No       | --      | Filter by chunk type                               |
| `top_k`      | `number` | No       | `10`    | Number of results (1--100)                         |

**Response (200):**
```json
{
  "results": [
    {
      "file_path": "packages/core/src/embedding/hybrid-search.ts",
      "chunk_type": "class",
      "name": "HybridSearch",
      "content": "export class HybridSearch { ... }",
      "nl_summary": "Combines vector and BM25 search with Reciprocal Rank Fusion.",
      "score": 0.92
    }
  ],
  "total": 1
}
```

> **Example: > ```bash**
> curl -X POST http://localhost:3100/api/v1/search \
>   -H "X-API-Key: your-api-key" \
>   -H "Content-Type: application/json" \
>   -d '{"query": "dependency graph traversal", "top_k": 5}'
> ```

**Error Responses:**
- `400` -- Validation error (invalid request body)
- `503` -- Search index not initialized

---

### POST /api/v1/context

Assembles rich context for a file including dependency graph expansion and token budget optimization. Requires authentication.

**Request Body:**

| Field                | Type      | Required | Default | Description                                           |
| -------------------- | --------- | -------- | ------- | ----------------------------------------------------- |
| `file_path`          | `string`  | Yes      | --      | File path to gather context for                       |
| `include_tests`      | `boolean` | No       | `true`  | Include test files                                    |
| `include_interfaces` | `boolean` | No       | `true`  | Include interface/type alias definitions              |
| `max_tokens`         | `number`  | No       | `8000`  | Maximum token budget (1--128000)                      |

**Response (200):**
```json
{
  "context": "<primary_results>...\n</primary_results>\n<related_context>...</related_context>",
  "token_count": 3842,
  "truncated": false,
  "primary_chunks": 4,
  "related_chunks": 6
}
```

> **Example: > ```bash**
> curl -X POST http://localhost:3100/api/v1/context \
>   -H "X-API-Key: your-api-key" \
>   -H "Content-Type: application/json" \
>   -d '{"file_path": "src/embedding/hybrid-search.ts", "max_tokens": 4000}'
> ```

---

## Status

### GET /api/v1/status

Returns index health, chunk count, and configuration info. Requires authentication.

**Response (200):**
```json
{
  "total_chunks": 1247,
  "last_indexed": null,
  "model": "nomic-embed-text",
  "languages": ["typescript"],
  "health": "ok"
}
```

Health values: `ok` | `degraded` | `not_initialized`.

```bash
curl http://localhost:3100/api/v1/status -H "X-API-Key: your-api-key"
```

---

## Index

### POST /api/v1/index

Triggers re-indexing of the codebase. **Requires admin role.**

**Request Body:**

| Field      | Type      | Required | Default | Description                                  |
| ---------- | --------- | -------- | ------- | -------------------------------------------- |
| `root_dir` | `string`  | No       | --      | Root directory to index (no `..` allowed)    |
| `force`    | `boolean` | No       | `false` | Force full re-index (ignore incremental)     |

**Response (200):**
```json
{
  "status": "completed",
  "indexed_files": 142,
  "duration_ms": 12450
}
```

> **Warning: > This endpoint requires an admin API key. Non-admin keys receive a `403 Forbidden` response.**

```bash
curl -X POST http://localhost:3100/api/v1/index \
  -H "X-API-Key: admin-api-key" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

**Error Responses:**
- `403` -- Non-admin API key
- `503` -- Indexing service not configured

---

## Team

### POST /api/v1/team/connect

Connects the instance to a cloud storage provider for team-shared indexes. Requires authentication.

**Request Body:**

| Field       | Type                                  | Required | Description                          |
| ----------- | ------------------------------------- | -------- | ------------------------------------ |
| `provider`  | `"s3"` \| `"azure-blob"` \| `"gcs"` | Yes      | Cloud storage provider               |
| `team_id`   | `string`                              | Yes      | Team identifier                      |
| `bucket`    | `string`                              | No       | S3/GCS bucket name                   |
| `container` | `string`                              | No       | Azure Blob container name            |
| `region`    | `string`                              | No       | AWS region                           |

**Response (200):**
```json
{
  "status": "connected",
  "team_id": "team-alpha",
  "provider": "s3",
  "connected_at": "2026-02-23T10:00:00.000Z"
}
```

---

### GET /api/v1/team/analytics

Returns team-level query analytics. Requires authentication.

**Response (200):**
```json
{
  "top_queries": [
    { "query": "dependency graph", "count": 15 }
  ],
  "coverage_gaps": [],
  "total_queries": 142,
  "unique_users": 8
}
```

---

### POST /api/v1/team/sync

Triggers synchronization of the index to cloud storage. Requires authentication.

**Request Body:**

| Field   | Type      | Required | Default | Description           |
| ------- | --------- | -------- | ------- | --------------------- |
| `force` | `boolean` | No       | `false` | Force full sync       |

**Response (200):**
```json
{
  "status": "synced",
  "files_synced": 1,
  "duration_ms": 245
}
```

---

## History & Bookmarks

### GET /api/v1/history

Lists the authenticated user's query history with pagination. Requires authentication.

**Query Parameters:**

| Parameter   | Type     | Default | Description             |
| ----------- | -------- | ------- | ----------------------- |
| `page`      | `number` | `1`     | Page number             |
| `page_size` | `number` | `20`    | Items per page (max 100) |

**Response (200):**
```json
{
  "items": [
    {
      "id": "hist-1",
      "user_id": "abc12345",
      "query": "hybrid search",
      "filters": {},
      "results_count": 10,
      "timestamp": "2026-02-23T10:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

---

### POST /api/v1/history

Records a query in the user's history. Requires authentication.

**Request Body:**

| Field           | Type                          | Required | Description               |
| --------------- | ----------------------------- | -------- | ------------------------- |
| `query`         | `string`                      | Yes      | Search query text         |
| `filters`       | `Record<string, unknown>`     | No       | Filters applied           |
| `results_count` | `number`                      | No       | Number of results returned |

**Response (201):** Returns the created history entry.

---

### DELETE /api/v1/history/:id

Deletes a specific history entry. Requires authentication. Returns `204` on success, `404` if not found.

---

### GET /api/v1/bookmarks

Lists the authenticated user's saved bookmarks. Requires authentication.

**Response (200):**
```json
{
  "items": [
    {
      "id": "bm-1",
      "user_id": "abc12345",
      "name": "Parser tests",
      "query": "tree-sitter parser",
      "filters": {},
      "created_at": "2026-02-23T10:00:00.000Z"
    }
  ],
  "total": 3
}
```

---

### POST /api/v1/bookmarks

Creates a new bookmark. Requires authentication.

**Request Body:**

| Field     | Type                      | Required | Description           |
| --------- | ------------------------- | -------- | --------------------- |
| `name`    | `string`                  | Yes      | Bookmark name         |
| `query`   | `string`                  | Yes      | Saved query           |
| `filters` | `Record<string, unknown>` | No       | Saved filters         |

**Response (201):** Returns the created bookmark.

---

### DELETE /api/v1/bookmarks/:id

Deletes a specific bookmark. Requires authentication. Returns `204` on success, `404` if not found.

---

## Viewer

These read-only endpoints power the [Viewer](../packages/viewer.md) web UI for exploring the index.

### GET /api/v1/viewer/stats

Returns index statistics.

**Response (200):**
```json
{
  "data": {
    "chunkCount": 1247,
    "fileCount": 250,
    "languages": ["typescript"],
    "storageBytes": null,
    "lastIndexed": null
  }
}
```

---

### GET /api/v1/viewer/chunks

Paginated listing of indexed chunks with optional filters.

**Query Parameters:**

| Parameter  | Type     | Default | Description                              |
| ---------- | -------- | ------- | ---------------------------------------- |
| `page`     | `number` | `1`     | Page number                              |
| `pageSize` | `number` | `50`    | Items per page (max 200)                 |
| `language` | `string` | --      | Filter by language                       |
| `type`     | `string` | --      | Filter by chunk type                     |
| `file`     | `string` | --      | Filter by file path substring            |
| `q`        | `string` | --      | Text search in content/summary/ID        |

**Response (200):**
```json
{
  "data": [
    {
      "id": "chunk-abc123",
      "filePath": "src/embedding/hybrid-search.ts",
      "chunkType": "class",
      "name": "HybridSearch",
      "language": "typescript",
      "startLine": 15,
      "endLine": 120,
      "contentPreview": "export class HybridSearch { ..."
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 50,
    "total": 1247,
    "totalPages": 25
  }
}
```

---

### GET /api/v1/viewer/chunks/:id

Returns full detail for a single chunk.

**Query Parameters:**

| Parameter      | Type                        | Default | Description                     |
| -------------- | --------------------------- | ------- | ------------------------------- |
| `includeVector`| `"true"` \| `"false"`       | `false` | Include the embedding vector    |

**Response (200):**
```json
{
  "data": {
    "id": "chunk-abc123",
    "filePath": "src/embedding/hybrid-search.ts",
    "chunkType": "class",
    "name": "HybridSearch",
    "language": "typescript",
    "startLine": 15,
    "endLine": 120,
    "content": "export class HybridSearch { ... }",
    "nlSummary": "Combines vector and BM25 search...",
    "metadata": { "declarations": ["search"], "imports": ["LanceDBStore"] },
    "vector": [0.012, -0.034, ...]
  }
}
```

---

### GET /api/v1/viewer/graph

Returns the dependency graph (nodes and edges) with optional filters.

**Query Parameters:**

| Parameter  | Type     | Default | Description                       |
| ---------- | -------- | ------- | --------------------------------- |
| `file`     | `string` | --      | Filter nodes by file path substring |
| `type`     | `string` | --      | Filter by node type (`module`, `class`, `function`) |
| `maxNodes` | `number` | `500`   | Maximum nodes to return (max 5000) |

**Response (200):**
```json
{
  "data": {
    "nodes": [
      { "id": "src/search.ts", "filePath": "src/search.ts", "symbols": ["search"], "type": "module" }
    ],
    "edges": [
      { "source": "src/search.ts", "target": "src/store.ts", "type": "imports" }
    ]
  }
}
```

---

### GET /api/v1/viewer/search

Search endpoint with timing information for the viewer playground.

**Query Parameters:**

| Parameter      | Type     | Default | Description                      |
| -------------- | -------- | ------- | -------------------------------- |
| `q`            | `string` | --      | Search query (required)          |
| `topK`         | `number` | `10`    | Number of results (max 100)      |
| `vectorWeight` | `number` | --      | Vector search weight (0--1)      |
| `bm25Weight`   | `number` | --      | BM25 search weight (0--1)        |

**Response (200):**
```json
{
  "data": {
    "results": [
      {
        "chunkId": "chunk-abc123",
        "filePath": "src/search.ts",
        "chunkType": "function",
        "name": "search",
        "content": "...",
        "nlSummary": "...",
        "score": 0.92,
        "method": "hybrid"
      }
    ],
    "timing": { "totalMs": 142 }
  }
}
```

---

### GET /api/v1/viewer/embeddings

Returns raw embedding vectors for UMAP visualization.

**Query Parameters:**

| Parameter | Type     | Default | Description                     |
| --------- | -------- | ------- | ------------------------------- |
| `limit`   | `number` | `500`   | Maximum embeddings (max 2000)   |

**Response (200):**
```json
{
  "data": [
    {
      "id": "chunk-abc123",
      "filePath": "src/search.ts",
      "chunkType": "function",
      "language": "typescript",
      "vector": [0.012, -0.034, ...]
    }
  ]
}
```

---

## Dashboard

The dashboard is mounted at `/dashboard` and provides server-rendered admin pages. Access requires an admin API key passed via `X-API-Key` header or `key` query parameter.

| Route                | Method | Description                     |
| -------------------- | ------ | ------------------------------- |
| `/dashboard`         | GET    | Main dashboard overview         |
| `/dashboard/config`  | GET    | Configuration viewer            |
| `/dashboard/reindex` | POST   | Trigger re-indexing from UI     |

---

## Authentication

All `/api/v1/*` endpoints require an API key. Keys are configured via the `CODERAG_API_KEYS` environment variable as a comma-separated list of `key:role` pairs:

```bash
CODERAG_API_KEYS="sk-abc123:admin,sk-def456:developer,sk-viewer789:viewer"
```

The key can be provided via:
- `X-API-Key` header
- `Authorization: Bearer <key>` header

> **Tip: > Rate limiting is applied per API key after authentication. Configure limits via environment variables `CODERAG_RATE_LIMIT_WINDOW_MS` and `CODERAG_RATE_LIMIT_MAX`.**

---

## CORS

The API server sets `Access-Control-Allow-Origin` to `*` by default. Override with the `corsOrigin` option in `ApiServerOptions`.

---

## See Also

- [API Server](../packages/api-server.md) -- Server setup, Docker deployment, and configuration
- [Cloud Deployment](../guides/cloud-deployment.md) -- Cloud deployment guide
- [MCP Tools](mcp-tools.md) -- MCP tool equivalents for AI agent consumption
- [Types](types.md) -- Full TypeScript type definitions
