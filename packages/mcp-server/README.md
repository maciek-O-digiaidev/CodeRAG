# @code-rag/mcp-server

MCP server for CodeRAG -- exposes codebase search, context, explain, and status tools via the Model Context Protocol (stdio and SSE transports).

## Installation

```bash
npm install @code-rag/mcp-server
```

## Tools

- `coderag_search` -- semantic + keyword hybrid search over the codebase
- `coderag_context` -- retrieve assembled context within a token budget
- `coderag_explain` -- explain code symbols with dependency context
- `coderag_status` -- show index health and statistics

## Documentation

See the [main repository](https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG) for full documentation.

## License

MIT
