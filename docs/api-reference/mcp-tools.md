---
tags:
  - api-reference
  - mcp
  - tools
  - agent-interface
aliases:
  - MCP Tools
  - MCP Tool Reference
  - coderag tools
---

# MCP Tools Reference

CodeRAG exposes 6 tools via the [MCP Server](../packages/mcp-server.md) using the Model Context Protocol (MCP). These tools give AI coding agents deep, semantic access to the codebase, documentation, and project backlog.

> **Tip: > All MCP tools return JSON wrapped in `{ content: [{ type: "text", text: "<json>" }] }` per the MCP specification. The examples below show only the inner JSON payload.**

---

## coderag_search

Performs hybrid semantic + keyword search across the indexed codebase. Combines vector embeddings (semantic similarity) with BM25 (keyword matching) using Reciprocal Rank Fusion. Results are optionally re-ranked with a cross-encoder model.

### Input Schema

| Parameter    | Type     | Required | Default | Description                                      |
| ------------ | -------- | -------- | ------- | ------------------------------------------------ |
| `query`      | `string` | Yes      | --      | Natural language or code search query (min 1 char) |
| `language`   | `string` | No       | --      | Filter results by programming language            |
| `file_path`  | `string` | No       | --      | Filter results to files containing this substring |
| `chunk_type` | `string` | No       | --      | Filter by chunk type (e.g., `function`, `class`)  |
| `top_k`      | `number` | No       | `10`    | Number of results to return (1--100)              |

> **Warning: > The `file_path` parameter must not contain path traversal sequences (`..`).**

### Output Format

```typescript
{
  results: Array<{
    file_path: string;    // Relative path to the source file
    chunk_type: string;   // function | method | class | module | interface | type_alias | doc
    name: string;         // Symbol name (function name, class name, etc.)
    content: string;      // Raw source code of the chunk
    nl_summary: string;   // Natural language description of the chunk
    score: number;        // Relevance score (0--1, higher is better)
  }>
}
```

### Example

**Request:**
```json
{
  "query": "hybrid search with BM25 and vector",
  "language": "typescript",
  "top_k": 3
}
```

**Response:**
```json
{
  "results": [
    {
      "file_path": "packages/core/src/embedding/hybrid-search.ts",
      "chunk_type": "class",
      "name": "HybridSearch",
      "content": "export class HybridSearch { ... }",
      "nl_summary": "HybridSearch combines vector similarity and BM25 keyword search using Reciprocal Rank Fusion to produce ranked results.",
      "score": 0.92
    }
  ]
}
```

> **Tip: > Use `chunk_type` filter to narrow results. For example, use `"interface"` to find only interface definitions, or `"function"` to find standalone functions.**

---

## coderag_context

Assembles rich context for a specific file by searching for matching chunks, expanding the dependency graph to include related code (tests, interfaces, callers), and optimizing the result within a token budget.

### Input Schema

| Parameter            | Type      | Required | Default | Description                                         |
| -------------------- | --------- | -------- | ------- | --------------------------------------------------- |
| `file_path`          | `string`  | Yes      | --      | File path to gather context for (min 1 char)        |
| `include_tests`      | `boolean` | No       | `true`  | Include test files in the context                   |
| `include_interfaces` | `boolean` | No       | `true`  | Include interface and type alias definitions         |
| `max_tokens`         | `number`  | No       | `8000`  | Maximum token budget for assembled context (1--128000) |

### Output Format

```typescript
{
  context: string;           // Assembled context string (formatted sections)
  token_count: number;       // Estimated token count of the assembled context
  truncated: boolean;        // Whether results were truncated to fit the budget
  primary_chunks: number;    // Number of primary chunks included
  related_chunks: number;    // Number of graph-expanded related chunks included
}
```

### Example

**Request:**
```json
{
  "file_path": "packages/core/src/embedding/hybrid-search.ts",
  "include_tests": true,
  "max_tokens": 4000
}
```

**Response:**
```json
{
  "context": "<primary_results>\n## HybridSearch (packages/core/src/embedding/hybrid-search.ts)\n...\n</primary_results>\n<related_context>\n## BM25Index ...\n</related_context>",
  "token_count": 3842,
  "truncated": false,
  "primary_chunks": 4,
  "related_chunks": 6
}
```

> **Note: > The context output uses XML-delimited sections (`<primary_results>`, `<related_context>`) for structured consumption by AI agents.**

---

## coderag_explain

Explains a code symbol or file by finding matching chunks and returning their natural language summaries. In `detailed` mode, includes the full source code and related symbols from the dependency graph.

### Input Schema

| Parameter      | Type                         | Required                           | Default      | Description                                |
| -------------- | ---------------------------- | ---------------------------------- | ------------ | ------------------------------------------ |
| `file_path`    | `string`                     | At least one of `file_path`/`name` | --           | File path to explain                       |
| `name`         | `string`                     | At least one of `file_path`/`name` | --           | Symbol name to explain (function, class)   |
| `detail_level` | `"brief"` \| `"detailed"`   | No                                 | `"detailed"` | Level of detail in the explanation         |

> **Warning: > At least one of `file_path` or `name` must be provided. If both are given, `name` takes precedence.**

### Output Format

```typescript
{
  explanation: {
    chunks: Array<{
      file_path: string;      // Source file path
      chunk_type: string;     // Chunk type
      name: string;           // Symbol name
      nl_summary: string;     // Natural language summary
      code?: string;          // Full source code (only in "detailed" mode)
    }>;
    detail_level: string;
    related_symbols?: string[];  // Related symbol names (only in "detailed" mode)
  };
  chunks_found: number;
}
```

### Example

**Request:**
```json
{
  "name": "TokenBudgetOptimizer",
  "detail_level": "brief"
}
```

**Response:**
```json
{
  "explanation": {
    "chunks": [
      {
        "file_path": "packages/core/src/retrieval/token-budget.ts",
        "chunk_type": "class",
        "name": "TokenBudgetOptimizer",
        "nl_summary": "TokenBudgetOptimizer assembles search results into a context string that fits within a configurable token budget, prioritizing primary results over related chunks."
      }
    ],
    "detail_level": "brief"
  },
  "chunks_found": 1
}
```

---

## coderag_status

Returns the current health and configuration status of the CodeRAG index. Takes no input parameters.

### Input Schema

This tool takes no parameters.

### Output Format

```typescript
{
  total_chunks: number;                          // Total indexed chunks
  last_indexed: string | null;                   // ISO timestamp of last indexing (null if unknown)
  model: string;                                 // Embedding model name
  languages: string[] | "auto";                  // Configured languages
  health: "ok" | "degraded" | "not_initialized"; // System health status
}
```

### Example

**Response:**
```json
{
  "total_chunks": 1247,
  "last_indexed": null,
  "model": "nomic-embed-text",
  "languages": ["typescript"],
  "health": "ok"
}
```

> **Note: > Health states: `ok` means the index has chunks and is queryable; `degraded` means the store is connected but empty or erroring; `not_initialized` means the store has not been set up yet.**

---

## coderag_backlog

Searches, retrieves, and lists project backlog items (epics, stories, tasks, bugs, features) from a connected backlog provider (Azure DevOps, Jira, or ClickUp).

### Input Schema

| Parameter | Type                                            | Required                        | Default | Description                                       |
| --------- | ----------------------------------------------- | ------------------------------- | ------- | ------------------------------------------------- |
| `action`  | `"search"` \| `"get"` \| `"list"`             | Yes                             | --      | Operation to perform                              |
| `query`   | `string`                                        | Required for `search`           | --      | Search query text                                 |
| `id`      | `string`                                        | Required for `get`              | --      | Item ID to retrieve                               |
| `types`   | `("epic"\|"story"\|"task"\|"bug"\|"feature")[]` | No                              | --      | Filter by item types                              |
| `states`  | `string[]`                                      | No                              | --      | Filter by item states (e.g., `["Active"]`)        |
| `tags`    | `string[]`                                      | No                              | --      | Filter by tags                                    |
| `limit`   | `number`                                        | No                              | `10`    | Maximum items to return (1--50)                   |

### Output Format

**For `search` and `list` actions:**
```typescript
{
  items: Array<{
    id: string;              // Internal ID
    externalId: string;      // Provider-specific ID (e.g., "AB#123", "PROJ-456")
    title: string;           // Item title
    type: BacklogItemType;   // epic | story | task | bug | feature
    state: string;           // Current state (e.g., "Active", "Resolved")
    tags: string[];          // Associated tags
    url?: string;            // Web URL to view the item
  }>
}
```

**For `get` action:**
```typescript
{
  item: {
    id: string;
    externalId: string;
    title: string;
    type: BacklogItemType;
    state: string;
    tags: string[];
    url?: string;
    linkedCodePaths?: string[];  // File paths linked to this item
  }
}
```

### Example

**Request:**
```json
{
  "action": "search",
  "query": "hybrid search implementation",
  "types": ["story", "task"],
  "limit": 5
}
```

**Response:**
```json
{
  "items": [
    {
      "id": "item-1",
      "externalId": "AB#40",
      "title": "Hybrid Search with RRF",
      "type": "story",
      "state": "Resolved",
      "tags": ["search", "embedding"],
      "url": "https://dev.azure.com/org/project/_workitems/edit/40"
    }
  ]
}
```

---

## coderag_docs

Searches indexed documentation (Markdown files, Confluence pages) with semantic and keyword matching. Filters results to only documentation chunks and optionally by source type.

### Input Schema

| Parameter   | Type                                       | Required | Default | Description                                      |
| ----------- | ------------------------------------------ | -------- | ------- | ------------------------------------------------ |
| `query`     | `string`                                   | Yes      | --      | Search query for documentation (min 1 char)      |
| `source`    | `"markdown"` \| `"confluence"` \| `"all"` | No       | `"all"` | Filter by documentation source                   |
| `file_path` | `string`                                   | No       | --      | Filter results to files containing this substring |
| `top_k`     | `number`                                   | No       | `10`    | Number of results to return (1--100)              |

### Output Format

```typescript
{
  results: Array<{
    file_path: string;                              // Path or URI of the document
    heading: string;                                // Document title or section heading
    content: string;                                // Raw document content
    nl_summary: string;                             // Natural language summary
    score: number;                                  // Relevance score (0--1)
    source: "markdown" | "confluence" | "unknown";  // Detected source type
  }>
}
```

### Example

**Request:**
```json
{
  "query": "how to configure embedding providers",
  "source": "markdown",
  "top_k": 5
}
```

**Response:**
```json
{
  "results": [
    {
      "file_path": "docs/configuration.md",
      "heading": "Embedding Configuration",
      "content": "## Embedding Configuration\n\nCodeRAG supports multiple embedding providers...",
      "nl_summary": "Describes how to configure embedding providers including Ollama, Voyage, and OpenAI in the .coderag.yaml file.",
      "score": 0.88,
      "source": "markdown"
    }
  ]
}
```

> **Tip: > Source detection is based on file path: `.md`/`.mdx` files are classified as `markdown`, paths containing `confluence://` are classified as `confluence`.**

---

## Error Handling

All tools follow a consistent error pattern. When an error occurs, the response payload includes:

```typescript
{
  error: string;           // Error category
  message?: string;        // Human-readable error description
  details?: ZodIssue[];    // Validation error details (input validation failures only)
}
```

Common error responses:

| Scenario                  | Error                          | Cause                                     |
| ------------------------- | ------------------------------ | ----------------------------------------- |
| Invalid input             | `"Invalid input"`              | Parameters fail Zod schema validation     |
| Index not ready           | `"Search index not initialized"` | Indexing has not been run yet           |
| Search failure            | `"Search failed"`              | Internal search engine error              |
| Provider not configured   | `"Backlog provider not initialized"` | No backlog provider in config       |

## See Also

- [MCP Server](../packages/mcp-server.md) -- MCP server setup and transport configuration
- [Types](types.md) -- Full type definitions for Chunk, SearchResult, etc.
- [REST API](rest-api.md) -- REST API alternative to MCP tools
