# CodeRAG — Project Context for AI Agents

## What is CodeRAG?
CodeRAG is an intelligent codebase context engine for AI coding agents. It creates a semantic vector database (RAG) from source code, documentation, and project backlog, then exposes it as MCP tools that give AI agents deep understanding of the entire codebase.

## Architecture
```
Sources (Git, Jira, Confluence, MD)
  → Ingestion Pipeline (Tree-sitter AST, NL enrichment, metadata)
    → Embedding & Storage (LanceDB, BM25 index, dependency graph)
      → Retrieval Engine (hybrid search, graph expansion, re-ranking, token budget)
        → Agent Interface (MCP Server: coderag_search, coderag_context, coderag_status)
```

## Tech Stack
- **Language**: TypeScript (Node.js, ESM)
- **Code parsing**: Tree-sitter (WASM bindings)
- **Embedding (local)**: Ollama + nomic-embed-text
- **Embedding (API)**: voyage-code-3, OpenAI text-embedding-3-small
- **Vector DB**: LanceDB (embedded, zero-infra)
- **Keyword search**: MiniSearch (BM25)
- **NL Summarization**: Ollama (qwen2.5-coder / llama3.2)
- **MCP Server**: @modelcontextprotocol/sdk
- **CLI**: Commander.js
- **Testing**: Vitest with coverage
- **Package manager**: pnpm workspaces

## Project Structure
```
coderag/
├── packages/
│   ├── core/              # Core library: ingestion, embedding, retrieval
│   │   ├── src/
│   │   │   ├── ingestion/  # Tree-sitter parser, chunking, NL enrichment
│   │   │   ├── embedding/  # Provider abstraction, LanceDB, BM25
│   │   │   ├── retrieval/  # Hybrid search, graph expansion, context assembly
│   │   │   ├── config/     # .coderag.yaml parser
│   │   │   └── types/      # Shared TypeScript types
│   │   └── tests/
│   ├── cli/               # CLI tool (coderag init/index/search/serve/status)
│   │   ├── src/
│   │   └── tests/
│   ├── mcp-server/        # MCP server (stdio + SSE transport)
│   │   ├── src/
│   │   └── tests/
│   └── benchmarks/        # Benchmark suite
│       ├── datasets/
│       └── src/
├── .coderag.yaml          # Project config (dogfooding!)
├── CLAUDE.md              # This file
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Coding Conventions
- **TypeScript strict mode** — no `any`, no `as` casts without justification
- **ESM modules** — use `import/export`, no `require()`
- **Functional style** — prefer pure functions, minimize mutable state
- **Error handling** — use Result<T, E> pattern (neverthrow), no uncaught throws
- **Naming**: camelCase for functions/vars, PascalCase for types/classes, UPPER_SNAKE for constants
- **Files**: kebab-case (e.g., `tree-sitter-parser.ts`)
- **Tests**: co-located `*.test.ts` files, describe/it pattern, 80%+ coverage on core
- **Abstractions**: use interfaces for providers (EmbeddingProvider, VectorStore, BacklogProvider)
- **Config**: all configuration via .coderag.yaml, sensible defaults for everything

## Key Design Decisions
1. **NL enrichment before embedding** — translate code to natural language descriptions before creating embeddings (proven 10x improvement by Greptile)
2. **AST-based chunking** — use Tree-sitter AST to create semantically meaningful chunks, not arbitrary line splits
3. **Hybrid search** — combine vector (semantic) + BM25 (keyword) with Reciprocal Rank Fusion
4. **Graph expansion** — after finding relevant chunks, expand results using dependency graph (tests, interfaces, callers)
5. **Token budget optimization** — assemble context within agent's token budget, prioritize by relevance
6. **Provider pattern** — all external dependencies behind interfaces for easy swapping
7. **Local-first** — everything works offline with Ollama + LanceDB, no cloud required

## Important Context
- This project is built using AI coding agents (dogfooding)
- MCP (Model Context Protocol) is the primary delivery mechanism
- Privacy-first: code never leaves the machine without explicit opt-in
- Performance targets: 50k LOC indexing < 5 min, query < 500ms

## ADO Project
- **Organization**: momc-pl
- **Project**: CodeRAG
- **Repo**: https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
- **Process**: Agile (Epic → User Story → Task)
- **Branch convention**: `feature/AB#XXXX-short-description`
