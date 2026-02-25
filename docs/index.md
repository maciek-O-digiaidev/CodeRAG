---
tags:
  - home
  - moc
aliases:
  - Home
  - CodeRAG Documentation
  - MOC
---

# CodeRAG Documentation

**CodeRAG** is an intelligent codebase context engine for AI coding agents. It creates a semantic vector database (RAG) from source code, documentation, and project backlog, then exposes it as [MCP tools](api-reference/mcp-tools.md) that give AI agents deep understanding of the entire codebase.

```mermaid
flowchart LR
    subgraph Sources
        S1[Git Repos]
        S2[Backlog<br/>ADO / Jira / ClickUp]
        S3[Docs<br/>Confluence / SharePoint / MD]
    end

    subgraph Ingestion["Ingestion Pipeline"]
        P[Tree-sitter<br/>AST Parser]
        C[AST Chunker]
        E[NL Enrichment<br/>Ollama]
    end

    subgraph Storage["Storage Layer"]
        V[LanceDB / Qdrant<br/>Vector Store]
        B[MiniSearch<br/>BM25 Index]
        G[Dependency<br/>Graph]
    end

    subgraph Retrieval["Retrieval Engine"]
        H[Hybrid Search<br/>+ RRF]
        X[Graph Expansion<br/>+ Re-ranking]
        T[Token Budget<br/>Optimizer]
    end

    subgraph Interface["Agent Interface"]
        M[MCP Server<br/>6 Tools]
        R[REST API]
        VS[VS Code<br/>Extension]
        VW[Web Viewer]
    end

    S1 & S2 & S3 --> P --> C --> E --> V & B & G
    V & B & G --> H --> X --> T
    T --> M & R & VS & VW
```

## Getting Started

| Page | Description |
|------|-------------|
| [Installation](installation.md) | Prerequisites, setup, Ollama models |
| [Quick Start](getting-started/quick-start.md) | First index + search in 5 minutes |
| [Configuration](configuration.md) | Full `.coderag.yaml` reference |

## Architecture

| Page | Description |
|------|-------------|
| [Overview](architecture/overview.md) | High-level architecture, tech stack, design principles |
| [Ingestion Pipeline](architecture/ingestion-pipeline.md) | Parse → Chunk → Enrich → Embed → Store |
| [Retrieval Pipeline](architecture/retrieval-pipeline.md) | Query → Analyze → Search → Expand → Budget |
| [Hybrid Search](architecture/hybrid-search.md) | Vector + BM25 + Reciprocal Rank Fusion |
| [Dependency Graph](architecture/dependency-graph.md) | Graph model, edges, BFS expansion |
| [Design Decisions](architecture/design-decisions.md) | ADR-style rationale for key decisions |

## Packages

| Package | NPM | Description |
|---------|-----|-------------|
| [Core](packages/core.md) | `@code-rag/core` | Shared library — ingestion, embedding, retrieval, auth |
| [CLI](packages/cli.md) | `@code-rag/cli` | CLI tool — `coderag init/index/search/serve/status/viewer` |
| [MCP Server](packages/mcp-server.md) | `@code-rag/mcp-server` | MCP server — stdio + SSE transport |
| [API Server](packages/api-server.md) | `@code-rag/api-server` | Express REST API — team/cloud deployment |
| [Viewer](packages/viewer.md) | `@code-rag/viewer` | Vite SPA — dashboard, search, graph, UMAP |
| [VS Code Extension](packages/vscode-extension.md) | `code-rag-vscode` | VS Code integration — search panel, auto-config |
| [Benchmarks](packages/benchmarks.md) | — | Benchmark suite — precision, recall, MRR |

## API Reference

| Page | Description |
|------|-------------|
| [MCP Tools](api-reference/mcp-tools.md) | All 6 MCP tools with schemas and examples |
| [REST API](api-reference/rest-api.md) | All REST endpoints with request/response formats |
| [Types](api-reference/types.md) | Core TypeScript types (Chunk, SearchResult, Config, ...) |
| [Interfaces](api-reference/interfaces.md) | Provider interfaces (EmbeddingProvider, VectorStore, ...) |

## Guides

| Page | Description |
|------|-------------|
| [Multi Repo](guides/multi-repo.md) | Multi-repository setup and cross-repo resolution |
| [Backlog Integration](guides/backlog-integration.md) | Azure DevOps, Jira, ClickUp integration |
| [Cloud Deployment](guides/cloud-deployment.md) | API server, Docker, auth, RBAC, team storage |
| [Embedding Providers](guides/embedding-providers.md) | Ollama, Voyage, OpenAI — setup and comparison |
| [Contributing](guides/contributing.md) | Development workflow, conventions, testing |

## Reference

| Page | Description |
|------|-------------|
| [Glossary](reference/glossary.md) | Key terms and definitions |
| [Project History](reference/project-history.md) | Sprint timeline, milestones, stats |

---

> **Info: About this documentation**
> This vault contains **27 interconnected pages** covering the full CodeRAG system. Use Obsidian's graph view to explore relationships between concepts, or navigate via the links above.

> **Tip: Quick links**
> - **I want to use CodeRAG** → Start with [Installation](installation.md) → [Quick Start](getting-started/quick-start.md)
> - **I want to understand how it works** → Read [Overview](architecture/overview.md) → [Ingestion Pipeline](architecture/ingestion-pipeline.md) → [Retrieval Pipeline](architecture/retrieval-pipeline.md)
> - **I want to integrate with my AI agent** → See [MCP Tools](api-reference/mcp-tools.md) or [REST API](api-reference/rest-api.md)
> - **I want to contribute** → Read [Contributing](guides/contributing.md) → [Design Decisions](architecture/design-decisions.md)
