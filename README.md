# CodeRAG

**Intelligent codebase context engine for AI coding agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-1%2C670%20passing-brightgreen)](packages/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-F69220?logo=pnpm)](https://pnpm.io/)

CodeRAG creates a semantic vector database (RAG) from your source code, documentation, and project backlog, then exposes it as [MCP](https://modelcontextprotocol.io/) tools that give AI agents deep understanding of your entire codebase.

---

## Features

- **AST-based code parsing** -- Tree-sitter parses source code into semantically meaningful chunks (functions, classes, methods), not arbitrary line splits
- **Natural language enrichment** -- Each code chunk is summarized in plain English before embedding, improving search quality by up to 10x
- **Hybrid search** -- Combines vector similarity (semantic) with BM25 (keyword) using Reciprocal Rank Fusion
- **Dependency graph expansion** -- After finding relevant chunks, expands results using the code dependency graph (tests, interfaces, callers)
- **Token budget optimization** -- Assembles context within an agent's token budget, prioritized by relevance
- **MCP server with 6 tools** -- `coderag_search`, `coderag_context`, `coderag_explain`, `coderag_status`, `coderag_docs`, `coderag_backlog`
- **Incremental indexing** -- Only changed files are re-processed on subsequent runs
- **Multi-repo support** -- Index and search across multiple repositories seamlessly
- **Backlog integration** -- Azure DevOps, Jira, and ClickUp support
- **Documentation indexing** -- Markdown, Confluence, and SharePoint
- **Multiple embedding providers** -- Auto (default, manages Ollama lifecycle), Ollama, OpenAI-compatible, Voyage, OpenAI
- **Multiple vector stores** -- LanceDB (embedded, zero-infra), Qdrant
- **Web viewer** -- Dashboard, search playground, dependency graph, UMAP embedding explorer
- **VS Code extension** -- Search panel and auto-MCP configuration
- **REST API server** -- Team/cloud deployment with auth, RBAC, and audit logging
- **Local-first, privacy-first** -- Everything works offline; code never leaves your machine without explicit opt-in

## Architecture

```mermaid
flowchart LR
    subgraph Sources
        S1[Git Repos]
        S2[Backlog\nADO / Jira / ClickUp]
        S3[Docs\nConfluence / SharePoint / MD]
    end

    subgraph Ingestion["Ingestion Pipeline"]
        P[Tree-sitter\nAST Parser]
        C[AST Chunker]
        E[NL Enrichment\nOllama]
    end

    subgraph Storage["Storage Layer"]
        V[LanceDB / Qdrant\nVector Store]
        B[MiniSearch\nBM25 Index]
        G[Dependency\nGraph]
    end

    subgraph Retrieval["Retrieval Engine"]
        H[Hybrid Search\n+ RRF]
        X[Graph Expansion\n+ Re-ranking]
        T[Token Budget\nOptimizer]
    end

    subgraph Interface["Agent Interface"]
        M[MCP Server\n6 Tools]
        R[REST API]
        VS[VS Code\nExtension]
        VW[Web Viewer]
    end

    S1 & S2 & S3 --> P --> C --> E --> V & B & G
    V & B & G --> H --> X --> T
    T --> M & R & VS & VW
```

## Quick Start

**Prerequisites:** [Node.js](https://nodejs.org/) >= 20, [Ollama](https://ollama.com/) running with `nomic-embed-text` and `qwen2.5-coder:7b` models pulled.

```bash
# 1. Install
npm install -g @coderag/cli

# 2. Initialize in your project directory
coderag init

# 3. Index your codebase
coderag index

# 4. Search
coderag search "how does authentication work"
```

That is it. CodeRAG will parse your code into AST chunks, enrich them with natural language summaries, create embeddings, and build a hybrid search index. Subsequent `coderag index` runs are incremental -- only changed files are re-processed.

### Start the MCP server for AI agents

```bash
# stdio transport (default, for direct agent integration)
coderag serve

# SSE transport (for network access)
coderag serve --port 3000
```

### Connect to Claude Desktop

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "coderag": {
      "command": "npx",
      "args": ["coderag", "serve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| [`@coderag/core`](packages/core/) | `@coderag/core` | Core library -- ingestion, embedding, retrieval, auth |
| [`@coderag/cli`](packages/cli/) | `@coderag/cli` | CLI tool -- `coderag init/index/search/serve/status/viewer` |
| [`@coderag/mcp-server`](packages/mcp-server/) | `@coderag/mcp-server` | MCP server -- stdio + SSE transport |
| [`@coderag/api-server`](packages/api-server/) | `@coderag/api-server` | Express REST API -- team/cloud deployment |
| [`@coderag/viewer`](packages/viewer/) | (private) | Vite SPA -- dashboard, search, graph, UMAP |
| [`coderag-vscode`](packages/vscode-extension/) | (private) | VS Code extension -- search panel, auto-config |
| [`@coderag/benchmarks`](packages/benchmarks/) | (private) | Benchmark suite -- precision, recall, MRR |

## CLI Commands

| Command | Description |
|---------|-------------|
| `coderag init` | Initialize a new project (creates `.coderag.yaml` and `.coderag/` storage) |
| `coderag index` | Index the codebase (incremental by default, `--full` for rebuild) |
| `coderag search <query>` | Hybrid search with `--language`, `--type`, `--file`, `--top-k` filters |
| `coderag serve` | Start MCP server (stdio default, `--port` for SSE) |
| `coderag status` | Show index health and statistics (`--json` for machine output) |
| `coderag viewer` | Launch the web-based viewer UI (`--port`, `--no-open`) |

## MCP Tools

| Tool | Description |
|------|-------------|
| `coderag_search` | Semantic + keyword hybrid search across the codebase |
| `coderag_context` | Assemble relevant context within a token budget |
| `coderag_explain` | Explain a code symbol with full surrounding context |
| `coderag_status` | Check index health and statistics |
| `coderag_docs` | Search indexed documentation (Markdown, Confluence, SharePoint) |
| `coderag_backlog` | Query project backlog items (ADO, Jira, ClickUp) |

## Tech Stack

| Category | Technology |
|----------|-----------|
| Language | TypeScript (Node.js, ESM, strict mode) |
| Code parsing | Tree-sitter (WASM bindings) |
| Embedding (local) | Ollama + nomic-embed-text |
| Embedding (API) | Voyage voyage-code-3, OpenAI text-embedding-3-small |
| Vector DB | LanceDB (embedded), Qdrant (external) |
| Keyword search | MiniSearch (BM25) |
| NL enrichment | Ollama (qwen2.5-coder, llama3.2) |
| MCP | @modelcontextprotocol/sdk |
| CLI | Commander.js |
| Testing | Vitest (1,670 tests) |
| Package manager | pnpm workspaces |

## Documentation

| Page | Description |
|------|-------------|
| [Installation](docs/installation.md) | Prerequisites, three installation methods |
| [Configuration](docs/configuration.md) | Full `.coderag.yaml` reference |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

See the [`docs/`](docs/) directory for additional documentation.

## Development

```bash
# Clone and install
git clone https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
cd CodeRAG
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run benchmarks
pnpm benchmark
```

## License

[MIT](LICENSE)
