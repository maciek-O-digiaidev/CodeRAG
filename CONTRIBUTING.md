# Contributing to CodeRAG

Thank you for your interest in contributing to CodeRAG! This guide will help you get started.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Conventions](#coding-conventions)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Issues](#reporting-issues)

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Ollama** (optional, for local embedding and summarization)

### Development Setup

1. Fork the repository on GitHub

2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/CodeRAG.git
   cd CodeRAG
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Build all packages:
   ```bash
   pnpm build
   ```

5. Run tests:
   ```bash
   pnpm test
   ```

6. (Optional) Start Ollama for local AI features:
   ```bash
   ollama pull nomic-embed-text
   ollama pull qwen2.5-coder
   ```

## Project Structure

```
coderag/
├── packages/
│   ├── core/              # Core library: ingestion, embedding, retrieval
│   ├── cli/               # CLI tool (coderag init/index/search/serve/status)
│   ├── mcp-server/        # MCP server (stdio + SSE transport)
│   ├── api-server/        # REST API server for cloud/team features
│   ├── viewer/            # Web-based visualization dashboard
│   ├── vscode-extension/  # VS Code extension
│   └── benchmarks/        # Benchmark suite
├── .coderag.yaml          # Project config (dogfooding)
├── CLAUDE.md              # AI agent context
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Coding Conventions

### TypeScript

- **Strict mode** -- no `any` types, no `as` casts without justification
- **ESM modules** -- use `import`/`export`, never `require()`
- **Functional style** -- prefer pure functions, minimize mutable state

### Error Handling

- Use the `Result<T, E>` pattern from `neverthrow` instead of throwing exceptions
- No uncaught throws in library code

### Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Functions/variables | camelCase | `parseChunks`, `chunkSize` |
| Types/classes | PascalCase | `CodeChunk`, `EmbeddingProvider` |
| Constants | UPPER_SNAKE | `MAX_CHUNK_SIZE`, `DEFAULT_MODEL` |
| Files | kebab-case | `tree-sitter-parser.ts`, `hybrid-search.ts` |

### Testing

- Co-located test files: `*.test.ts` next to source files
- Use `describe`/`it` pattern with Vitest
- Target 80%+ coverage on core package

### Architecture

- Use interfaces for all external providers (`EmbeddingProvider`, `VectorStore`, `BacklogProvider`)
- All configuration via `.coderag.yaml` with sensible defaults
- Local-first: everything works offline with Ollama + LanceDB

## Making Changes

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-description
   ```

2. Make your changes with tests

3. Verify everything works:
   ```bash
   pnpm build
   pnpm test
   pnpm lint
   ```

4. Commit your changes with a descriptive message:
   ```bash
   git commit -m "Add support for Python tree-sitter grammar"
   ```

## Submitting a Pull Request

1. Push your branch to your fork:
   ```bash
   git push origin feature/your-description
   ```

2. Open a Pull Request against the `main` branch

3. Fill out the PR template with:
   - Summary of changes
   - Test plan
   - Checklist items

4. Wait for CI checks to pass

5. Address any review feedback

### PR Guidelines

- Keep PRs focused -- one feature or fix per PR
- Include tests for new functionality
- Update documentation if behavior changes
- Ensure all CI checks pass before requesting review
- Rebase on `main` if your branch falls behind

## Reporting Issues

- Use the [Bug Report](https://github.com/momc-pl/CodeRAG/issues/new?template=bug_report.md) template for bugs
- Use the [Feature Request](https://github.com/momc-pl/CodeRAG/issues/new?template=feature_request.md) template for enhancements
- Search existing issues before creating a new one
- Include reproduction steps and environment details for bugs

## License

By contributing to CodeRAG, you agree that your contributions will be licensed under the [MIT License](LICENSE).
