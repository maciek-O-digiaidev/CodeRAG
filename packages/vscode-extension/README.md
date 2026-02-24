# CodeRAG for VS Code

Intelligent codebase context engine for AI coding agents -- semantic code search, RAG indexing, and MCP server integration directly in VS Code.

CodeRAG creates a semantic vector database from your source code, documentation, and project backlog, then exposes it as MCP tools that give AI agents deep understanding of your entire codebase.

## Features

### Semantic Code Search

Search your codebase using natural language queries. CodeRAG combines vector (semantic) and BM25 (keyword) search with Reciprocal Rank Fusion for highly relevant results.

- **Natural language queries** -- ask questions like "how does authentication work?" instead of searching for exact symbols
- **Hybrid search** -- combines semantic understanding with keyword matching
- **Ranked results** -- results are re-ranked by relevance with code snippets and file locations

### Search Panel

A dedicated sidebar panel with a rich search interface:

- Enter queries and see results inline with code previews
- Click results to open files at the exact location
- Filter by file type, path, or language

### MCP Server Integration

Automatically configures the CodeRAG MCP server for AI coding agents:

- **Auto-start** -- the MCP server starts automatically when your workspace contains a `.coderag.yaml` file
- **Claude Code integration** -- opt-in auto-configuration of Claude Code MCP settings
- **Status bar** -- see connection status and indexed chunk count at a glance

### Codebase Indexing

Trigger indexing directly from VS Code:

- **Index command** -- run `CodeRAG: Index` to index your codebase
- **Status command** -- run `CodeRAG: Status` to check index health and chunk counts
- **Incremental updates** -- only changed files are re-indexed

## Requirements

- **Node.js** >= 20
- **CodeRAG CLI** installed (`npm install -g @coderag/cli`)
- A `.coderag.yaml` configuration file in your workspace root
- For local embeddings: [Ollama](https://ollama.ai/) running with the `nomic-embed-text` model

## Quick Start

1. Install the CodeRAG extension from the Marketplace
2. Open a workspace that has a `.coderag.yaml` file (or run `coderag init` from the terminal)
3. The extension activates automatically and starts the MCP server
4. Open the CodeRAG sidebar panel to search your codebase
5. Use `Ctrl+Shift+P` / `Cmd+Shift+P` and type "CodeRAG" to see all available commands

## Commands

| Command | Description |
|---------|-------------|
| `CodeRAG: Search` | Open a search input and display results |
| `CodeRAG: Index` | Trigger codebase indexing |
| `CodeRAG: Status` | Show index health and statistics |
| `CodeRAG: Configure Claude Code` | Set up Claude Code MCP integration |
| `CodeRAG: Configure` | Open the setup dialog to configure embedding provider and indexing |

## Configuration

This extension contributes the following settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `coderag.autoConfigureClaude` | `boolean` | `false` | Automatically detect Claude Code CLI and inject CodeRAG MCP server configuration into `.claude/settings.json` on activation. |

## How It Works

```
Source Code + Docs
  -> Tree-sitter AST parsing (semantic chunking)
    -> NL enrichment (natural language descriptions)
      -> Embedding (Ollama / Voyage / OpenAI)
        -> LanceDB + BM25 index
          -> Hybrid search with graph expansion
            -> MCP tools for AI agents
```

1. **Ingestion** -- CodeRAG parses your code using Tree-sitter AST to create semantically meaningful chunks
2. **Enrichment** -- Each chunk gets a natural language description for better semantic matching
3. **Embedding** -- Chunks are embedded using your configured provider (local Ollama or cloud APIs)
4. **Search** -- Queries combine vector similarity and BM25 keyword matching with Reciprocal Rank Fusion
5. **Context** -- Results are expanded using dependency graph analysis and assembled within token budgets

## Known Issues

- The extension currently connects to the MCP server via SSE on port 3100. Ensure this port is available.
- First-time indexing may take several minutes for large codebases (50k+ LOC).
- Local embedding with Ollama requires the `nomic-embed-text` model to be pulled first.

## Privacy

CodeRAG is **local-first**. Your code never leaves your machine unless you explicitly configure a cloud embedding provider. All indexing and search happens locally using LanceDB and Ollama.

## Links

- [Project Repository](https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG)
- [Issue Tracker](https://dev.azure.com/momc-pl/CodeRAG/_workitems)

## License

MIT
