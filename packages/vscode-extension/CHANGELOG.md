# Changelog

All notable changes to the CodeRAG VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-24

### Added

- **Search Panel** -- sidebar webview with rich search interface for querying the CodeRAG index
- **Semantic Search command** -- `CodeRAG: Search` for natural language code search via quick input
- **Index command** -- `CodeRAG: Index` to trigger codebase indexing from VS Code
- **Status command** -- `CodeRAG: Status` to view index health and chunk statistics
- **MCP Server integration** -- auto-starts the CodeRAG MCP server when a `.coderag.yaml` is detected
- **Claude Code configuration** -- `CodeRAG: Configure Claude Code` command and opt-in auto-configuration
- **Status bar item** -- displays connection status and indexed chunk count
- **Workspace activation** -- extension activates automatically when workspace contains `.coderag.yaml`

### Notes

- This is the initial preview release of the CodeRAG VS Code extension.
- Requires Node.js >= 20 and the CodeRAG CLI to be installed.
- MCP server connects via SSE on port 3100.

[Unreleased]: https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG?version=GBmain&_a=history
[0.1.0]: https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG?version=GTvscode-v0.1.0
