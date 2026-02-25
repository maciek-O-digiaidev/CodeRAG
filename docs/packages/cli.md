---
tags:
  - package
  - cli
  - commands
aliases:
  - "@code-rag/cli"
  - cli-package
  - coderag-command
---

# @code-rag/cli

The command-line interface for CodeRAG. Provides 6 commands to initialize, index, search, serve, inspect, and visualize your codebase. Built with Commander.js, styled with Chalk, and animated with Ora spinners.

**Package**: `@code-rag/cli`
**Binary**: `coderag`
**Dependencies**: `@code-rag/core`, `@code-rag/mcp-server`, `@code-rag/api-server`, `commander`, `chalk`, `ora`, `yaml`

---

## Commands

### `coderag init`

Initialize a new CodeRAG project in the current directory.

```bash
coderag init [options]
```

| Option | Description |
|--------|-------------|
| `--languages <langs>` | Comma-separated list of languages (overrides auto-detection) |
| `--force` | Overwrite existing `.coderag.yaml` |
| `--multi` | Generate multi-repo configuration with `repos` array |

**What it does:**

1. Scans the directory tree to auto-detect programming languages by file extension
2. Generates `.coderag.yaml` with sensible defaults (Ollama provider, nomic-embed-text, 512 token chunks)
3. Creates the `.coderag/` storage directory
4. Checks Ollama connectivity at `OLLAMA_HOST` (default `http://localhost:11434`)

**Supported languages for auto-detection:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, C, C++, Ruby, PHP

**Examples:**

```bash
# Auto-detect languages and create config
coderag init

# Specify languages explicitly
coderag init --languages typescript,python

# Multi-repo setup
coderag init --multi

# Overwrite existing config
coderag init --force
```

---

### `coderag index`

Index the codebase by running the full pipeline: scan, parse, chunk, enrich, embed, and store.

```bash
coderag index [options]
```

| Option | Description |
|--------|-------------|
| `--full` | Force a complete re-index (ignore incremental state) |

**What it does:**

1. Loads `.coderag.yaml` configuration
2. Scans files using `.gitignore`-aware filtering
3. **Incremental mode** (default): compares file hashes against `index-state.json`, processes only changed files
4. **Full mode** (`--full`): re-indexes everything from scratch
5. Parses source files with Tree-sitter
6. Chunks using AST-aware boundaries
7. Enriches chunks with NL summaries via Ollama
8. Embeds using the configured embedding provider
9. Stores vectors in LanceDB, builds BM25 index, builds dependency graph
10. **Multi-repo**: if `repos` array is configured, indexes each repo independently with separate storage

**Examples:**

```bash
# Incremental index (only changed files)
coderag index

# Full re-index
coderag index --full
```

> **Note: > If NL enrichment fails (e.g., Ollama is unavailable), indexing continues without summaries rather than aborting.**

---

### `coderag search`

Search the indexed codebase using hybrid semantic + keyword search.

```bash
coderag search <query> [options]
```

| Option | Description |
|--------|-------------|
| `--language <lang>` | Filter by programming language |
| `--type <chunkType>` | Filter by chunk type (`function`, `class`, `method`, etc.) |
| `--file <path>` | Filter by file path substring |
| `--top-k <n>` | Maximum number of results (default: `10`) |

**What it does:**

1. Loads config and connects to LanceDB and BM25 index
2. Runs hybrid search (vector + BM25 with Reciprocal Rank Fusion)
3. Applies post-search filters (language, type, file path)
4. Displays results with rank, file path, line range, chunk type, score, and NL summary

**Examples:**

```bash
# Basic search
coderag search "hybrid search implementation"

# Filter by language and type
coderag search "parse AST" --language typescript --type function

# Limit results
coderag search "error handling" --top-k 5

# Filter by file path
coderag search "config" --file "config/"
```

---

### `coderag serve`

Start the CodeRAG MCP server for AI agent integration.

```bash
coderag serve [options]
```

| Option | Description |
|--------|-------------|
| `--port <port>` | Port for SSE transport (omit for stdio) |

**What it does:**

1. Creates a `CodeRAGServer` instance and initializes all services
2. **Without `--port`**: starts on stdio transport (for Claude Desktop, Cursor, etc.)
3. **With `--port`**: starts on SSE transport at `http://localhost:<port>/sse`
4. Registers graceful shutdown on SIGINT/SIGTERM

**Examples:**

```bash
# Start on stdio (for Claude Desktop)
coderag serve

# Start on SSE transport
coderag serve --port 3100
```

> **Tip: > Use stdio transport for direct MCP integration with Claude Desktop. Use SSE transport when the server needs to be accessed over HTTP (e.g., from the VS Code extension).**

---

### `coderag status`

Show the current CodeRAG index status.

```bash
coderag status [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |

**What it does:**

1. Loads config and connects to LanceDB
2. Reports: health (`ok` / `degraded` / `not_initialized`), total chunks, embedding model, dimensions, languages, storage path

**Health states:**

| State | Meaning |
|-------|---------|
| `ok` | Config loaded, LanceDB connected, chunks > 0 |
| `degraded` | Config loaded but no chunks or LanceDB error |
| `not_initialized` | No `.coderag.yaml` found |

**Examples:**

```bash
# Human-readable output
coderag status

# JSON output (for scripting)
coderag status --json
```

---

### `coderag viewer`

Launch the CodeRAG Viewer web interface.

```bash
coderag viewer [options]
```

| Option | Description |
|--------|-------------|
| `-p, --port <port>` | Port number (default: `3333`) |
| `--no-open` | Do not open browser automatically |

**What it does:**

1. Locates the pre-built viewer SPA (`@code-rag/viewer` dist)
2. Starts an HTTP server that serves the SPA static files
3. Initializes the API server and proxies `/api/*` requests to it
4. Falls back to `index.html` for client-side hash routing
5. Opens the default browser (unless `--no-open`)

**Examples:**

```bash
# Launch viewer on default port
coderag viewer

# Custom port, no browser
coderag viewer --port 8080 --no-open
```

> **Warning: > The viewer must be built first: `pnpm --filter @code-rag/viewer build`**

---

## See Also

- [Quick Start](../getting-started/quick-start.md) -- getting started guide
- [MCP Server](mcp-server.md) -- MCP server details
- [Viewer](viewer.md) -- viewer SPA documentation
