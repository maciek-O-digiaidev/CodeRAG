---
tags:
  - package
  - mcp
  - server
  - ai-agents
aliases:
  - "@code-rag/mcp-server"
  - mcp-server-package
  - MCP
---

# @code-rag/mcp-server

The MCP (Model Context Protocol) server that exposes CodeRAG's search, context, and status capabilities as tools that AI coding agents can invoke.

**Package**: `@code-rag/mcp-server`
**Version**: 0.1.0
**Dependencies**: `@code-rag/core`, `@modelcontextprotocol/sdk`, `zod`

## What is MCP?

MCP (Model Context Protocol) is an open standard that lets AI agents discover and invoke tools from external servers. CodeRAG implements an MCP server so that agents like Claude Desktop, Claude Code, and Cursor can query your codebase semantically without needing any custom integration code.

## CodeRAGServer Class

The main entry point is the `CodeRAGServer` class:

```typescript
import { CodeRAGServer } from '@code-rag/mcp-server';

const server = new CodeRAGServer({ rootDir: '/path/to/project' });
await server.initialize();

// Option A: stdio transport
await server.connectStdio();

// Option B: SSE transport on a port
await server.connectSSE(3100);
```

### Initialization

`initialize()` loads the project configuration and sets up all core services:

- Loads `.coderag.yaml` via `loadConfig()`
- Creates `OllamaEmbeddingProvider` with the configured model
- Connects to `LanceDBStore` for vector search
- Deserializes the `BM25Index` from disk
- Creates `HybridSearch` combining vector + BM25
- Loads the `DependencyGraph` for context expansion
- Optionally creates a `CrossEncoderReRanker` if configured

> **Note: > The server starts even if initialization fails. Individual tool calls will return errors if services are unavailable, but the server process remains running.**

## Transports

### stdio (default)

Used for direct process-to-process communication. The AI agent spawns the server as a child process and communicates over stdin/stdout.

```bash
coderag serve
```

### SSE (Server-Sent Events)

Used for HTTP-based communication. The server listens on a port and clients connect over HTTP.

```bash
coderag serve --port 3100
```

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sse` | GET | Establishes the SSE event stream |
| `/messages?sessionId=<id>` | POST | Sends JSON-RPC messages to the server |

The SSE transport supports multiple concurrent clients, each identified by a unique `sessionId`. CORS headers are set to allow all origins.

## Registered Tools

The server registers 6 MCP tools. See [MCP Tools](../api-reference/mcp-tools.md) for the full reference with parameters and response schemas.

| Tool | Description |
|------|-------------|
| `coderag_search` | Hybrid semantic + keyword search across the indexed codebase |
| `coderag_context` | Assemble token-budgeted context for a file, including dependency graph neighbors |
| `coderag_explain` | Get NL explanations of modules, functions, or classes |
| `coderag_status` | Report index health, chunk count, model info |
| `coderag_backlog` | Query project backlog items (ADO, Jira, ClickUp) linked to code |
| `coderag_docs` | Search project documentation (Markdown, Confluence) |

## Connecting from AI Clients

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coderag": {
      "command": "npx",
      "args": ["@code-rag/cli", "serve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Claude Code

Add to `.claude/settings.json` in your project root:

```json
{
  "mcpServers": {
    "coderag": {
      "command": "npx",
      "args": ["@code-rag/cli", "serve"],
      "cwd": "."
    }
  }
}
```

> **Tip: > The VS Code extension auto-generates this configuration. See [VS Code Extension](vscode-extension.md).**

### VS Code (SSE transport)

When using the CodeRAG VS Code extension, the server is started automatically on port 3100 with SSE transport. The extension's `ServerManager` handles lifecycle management.

```json
{
  "mcpServers": {
    "coderag": {
      "url": "http://localhost:3100/sse"
    }
  }
}
```

## Graceful Shutdown

Call `server.close()` to cleanly shut down. This closes all active SSE transports and stops the HTTP server. The CLI handles SIGINT and SIGTERM signals automatically.

## See Also

- [CLI](cli.md) -- the `coderag serve` command
- [MCP Tools](../api-reference/mcp-tools.md) -- full tool reference with parameters and examples
