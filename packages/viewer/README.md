# @code-rag/viewer

Web-based viewer for CodeRAG -- visual dashboard, chunk browser, search playground, dependency graph, and UMAP embedding explorer.

## Quick Start

```bash
# From any indexed CodeRAG project
coderag viewer
```

This starts a local server on `http://localhost:3333` and opens your browser.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port <port>` | `3333` | Port number |
| `--no-open` | | Do not open browser automatically |

## Views

### Dashboard

Overview of your indexed codebase: total chunks, files, embeddings, language distribution, and last indexing timestamp.

### Chunk Browser

Browse all indexed chunks with filtering by language, chunk type (function, class, method, doc), and file path. Click any chunk to see its full source code and NL summary.

### Search Playground

Interactive hybrid search interface. Enter a natural language query and see ranked results with relevance scores, file paths, and code previews. Useful for testing and tuning search quality.

### Dependency Graph

Visual graph of code dependencies -- imports, exports, extends, implements, calls. Navigate the graph to understand how modules and symbols are connected across the codebase.

### Embedding Explorer

2D/3D UMAP scatter plot of all chunk embeddings. Explore how your codebase clusters semantically. Three color modes:

- **By language** -- see how different languages cluster
- **By chunk type** -- functions vs classes vs docs
- **By file** -- spatial distribution of individual files

Uses a pure TypeScript UMAP implementation (zero external dependencies).

## Architecture

The viewer is a Vite SPA that communicates with the CodeRAG REST API (`/api/v1/viewer/*`). The API server is started automatically by `coderag viewer` and serves both the SPA static files and the API endpoints.

```
Browser (Vite SPA)
  ├── Dashboard   → GET /api/v1/viewer/stats
  ├── Chunks      → GET /api/v1/viewer/chunks
  ├── Search      → POST /api/v1/viewer/search
  ├── Graph       → GET /api/v1/viewer/graph
  └── Embeddings  → GET /api/v1/viewer/embeddings
```

## Development

```bash
# From the repo root
pnpm install

# Run viewer in dev mode (with HMR)
cd packages/viewer
pnpm dev

# Run tests
pnpm test
```

## License

MIT
