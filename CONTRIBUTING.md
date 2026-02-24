# Contributing to CodeRAG

Thank you for your interest in contributing to CodeRAG! This guide covers everything you need to know: from setting up your development environment to submitting a pull request.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Conventions](#coding-conventions)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [Branch and Commit Conventions](#branch-and-commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Adding New Providers](#adding-new-providers)
- [Reporting Issues](#reporting-issues)
- [License](#license)

---

## Getting Started

### Prerequisites

| Tool | Version | Required | Notes |
|------|---------|----------|-------|
| **Node.js** | >= 20 | Yes | LTS recommended |
| **pnpm** | >= 9 | Yes | `corepack enable && corepack prepare pnpm@latest --activate` |
| **Ollama** | latest | No | For local embedding and NL enrichment |
| **Git** | >= 2.30 | Yes | For version control and file watcher features |

### Forking the Repository

If you are an external contributor, start by forking the repository:

1. Fork the CodeRAG repository on Azure DevOps (or GitHub mirror if available)
2. Clone your fork locally:
   ```bash
   git clone https://dev.azure.com/<your-org>/CodeRAG/_git/CodeRAG
   cd CodeRAG
   ```
3. Add the upstream remote so you can keep your fork in sync:
   ```bash
   git remote add upstream https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
   ```
4. Create a feature branch for your changes:
   ```bash
   git checkout -b feature/AB#XXXX-short-description
   ```
5. After implementing and testing your changes, push to your fork and submit a Pull Request against the upstream `main` branch.

### Quick Start

The fastest way to get started is to use the bootstrap script:

```bash
git clone https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
cd CodeRAG
./scripts/bootstrap.sh
```

This will check prerequisites, install dependencies, build all packages, and run the test suite.

### Manual Setup

If you prefer to set things up manually:

```bash
# 1. Clone the repository
git clone https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
cd CodeRAG

# 2. Install dependencies
pnpm install

# 3. Build all packages
pnpm build

# 4. Run tests
pnpm test

# 5. (Optional) Set up Ollama for local AI features
ollama pull nomic-embed-text
ollama pull qwen2.5-coder
```

---

## Development Setup

### Package Manager

CodeRAG uses **pnpm workspaces**. Always use `pnpm` (not `npm` or `yarn`) for package operations:

```bash
# Install all workspace dependencies
pnpm install

# Build all packages (respects dependency order)
pnpm build

# Run all tests across all packages
pnpm test

# Run tests for a specific package
pnpm --filter @code-rag/core test

# Run with coverage
pnpm test -- --coverage

# Lint all packages
pnpm lint

# Clean all build artifacts
pnpm clean
```

### TypeScript Configuration

The project uses a shared `tsconfig.base.json` with strict settings. Each package extends it with its own `tsconfig.json`. Key compiler options:

- `target: ES2022` with `module: NodeNext` (ESM)
- `strict: true` (enables all strict checks)
- `noUncheckedIndexedAccess: true` (array/object index returns `T | undefined`)
- `noUnusedLocals: true` and `noUnusedParameters: true`
- `isolatedModules: true`

All imports must include the `.js` extension for NodeNext module resolution, even when the source file is `.ts`:

```typescript
// Correct
import { parseConfig } from './config-loader.js';

// Incorrect -- will fail at runtime
import { parseConfig } from './config-loader';
```

---

## Project Structure

CodeRAG is a pnpm workspace monorepo with 7 packages:

```
coderag/
  packages/
    core/               # Core library: ingestion, embedding, retrieval
    cli/                # CLI tool (coderag init/index/search/serve/status)
    mcp-server/         # MCP server (stdio + SSE transport)
    api-server/         # REST API server for cloud/team features
    viewer/             # Web-based visualization dashboard
    vscode-extension/   # VS Code extension
    benchmarks/         # Benchmark suite
  scripts/              # Development and CI scripts
  docs/                 # Documentation (architecture, guides, API reference)
  .coderag.yaml         # Project config (dogfooding)
  CLAUDE.md             # AI agent context
  pnpm-workspace.yaml   # Workspace definition
  tsconfig.base.json    # Shared TypeScript config
```

Each package has its own `package.json`, `tsconfig.json`, and builds independently. Cross-package dependencies use the workspace protocol (`workspace:*`).

---

## Coding Conventions

### TypeScript Strict Mode

- **No `any`** -- use `unknown` and narrow with type guards
- **No `as` casts** without a justifying comment explaining why
- **ESM modules only** -- use `import`/`export`, never `require()`
- All imports must include the `.js` extension for NodeNext resolution

```typescript
// Good -- explicit type narrowing
function getLength(value: unknown): number {
  if (typeof value === 'string') {
    return value.length;
  }
  return 0;
}

// Bad -- using `any` bypasses type safety
function getLength(value: any): number {
  return value.length;
}
```

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Functions / variables | camelCase | `parseChunks`, `topK`, `chunkSize` |
| Types / classes | PascalCase | `SearchResult`, `DependencyGraph`, `EmbeddingProvider` |
| Constants | UPPER_SNAKE_CASE | `BATCH_SIZE`, `DEFAULT_CONFIG`, `MAX_CHUNK_SIZE` |
| File names | kebab-case | `tree-sitter-parser.ts`, `hybrid-search.ts` |
| Test files | kebab-case + `.test.ts` | `hybrid-search.test.ts` |

### Functional Style

- Prefer **pure functions** over classes with mutable state
- Use **`readonly`** on interface properties and function parameters where possible
- Minimize mutable state -- favor `map`/`filter`/`reduce` over loops with mutation
- Use `ReadonlyArray`, `ReadonlyMap`, `ReadonlySet` for immutable collections

```typescript
// Good -- pure function, no side effects
function filterByLanguage(
  chunks: readonly Chunk[],
  language: string,
): Chunk[] {
  return chunks.filter((chunk) => chunk.metadata.language === language);
}

// Avoid -- mutating external state
function filterByLanguage(chunks: Chunk[], language: string): void {
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i]?.metadata.language !== language) {
      chunks.splice(i, 1);
    }
  }
}
```

### Provider Pattern

All external dependencies sit behind interfaces. This enables easy testing with mocks, swapping implementations without changing consumers, and clear dependency boundaries:

```typescript
// Define the interface in packages/core/src/types/provider.ts
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Result<number[][], EmbedError>>;
  readonly dimensions: number;
}

// Implement it
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  // ...
}
```

Key interfaces: `EmbeddingProvider`, `VectorStore`, `BacklogProvider`, `LLMProvider`, `Parser`, `Chunker`, `ReRanker`.

### Configuration

All configuration flows through `.coderag.yaml`. No hardcoded values for anything that could vary between environments. The config schema is validated with Zod at startup.

---

## Error Handling

CodeRAG uses the **Result pattern** from [neverthrow](https://github.com/supermacro/neverthrow) instead of throwing exceptions. Every public function that can fail must return `Result<T, E>`.

### Basic Pattern

```typescript
import { ok, err, type Result } from 'neverthrow';

// Define a typed error class
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

// Return Result instead of throwing
function parseConfig(raw: string): Result<Config, ParseError> {
  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = configSchema.safeParse(parsed);
    if (!validated.success) {
      return err(new ParseError(`Invalid config: ${validated.error.message}`));
    }
    return ok(validated.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return err(new ParseError(`Invalid config: ${message}`));
  }
}

// Consume with isOk/isErr
const result = parseConfig(input);
if (result.isErr()) {
  console.error(result.error.message);
  return;
}
const config = result.value; // Typed as Config
```

### Rules

- **No uncaught throws** in library code -- always return `Result<T, E>`
- Each module defines its own error class (e.g., `ParseError`, `EmbedError`, `StoreError`)
- Exceptions are reserved for truly unexpected situations (programmer errors)
- Use `.isOk()` / `.isErr()` to consume results, or `.map()` / `.andThen()` for chaining

---

## Testing

### Framework and Location

- **Vitest** is the test runner
- Tests are **co-located** with source files as `*.test.ts`
- Coverage target: **80%+** on `@code-rag/core`

### Test Structure

Use the `describe`/`it` pattern:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { parseConfig } from './config-loader.js';

describe('parseConfig', () => {
  it('should parse a valid YAML config', async () => {
    const result = await parseConfig('/path/to/config');
    expect(result.isOk()).toBe(true);
  });

  it('should return an error for missing config', async () => {
    const result = await parseConfig('/nonexistent');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });
});
```

### Running Tests

```bash
# Run all tests across all packages
pnpm test

# Run tests for a specific package
pnpm --filter @code-rag/core test

# Run with coverage report
pnpm test -- --coverage

# Run a specific test file
pnpm test -- packages/core/src/embedding/ollama-embedding-provider.test.ts

# Watch mode during development
pnpm --filter @code-rag/core test -- --watch
```

### Mocking

Use `vi.fn()` and `vi.spyOn()` for mocks. When testing against provider interfaces, create mock implementations rather than mocking internal details:

```typescript
import { ok } from 'neverthrow';
import type { EmbeddingProvider } from '../types/provider.js';

function createMockEmbeddingProvider(dimensions = 768): EmbeddingProvider {
  return {
    dimensions,
    embed: vi.fn().mockResolvedValue(ok([new Array(dimensions).fill(0)])),
  };
}
```

---

## Branch and Commit Conventions

### Branch Naming

All branches follow this pattern:

```
feature/AB#XXXX-short-description    (feature branches)
bugfix/AB#XXXX-fix-description       (bugfix branches)
```

Where `AB#XXXX` is the Azure DevOps work item ID.

```bash
# Create a feature branch
git checkout -b feature/AB#42-add-auth-middleware

# Create a bugfix branch
git checkout -b bugfix/AB#99-fix-search-timeout
```

### Commit Message Format

Commit messages start with the Azure DevOps work item ID:

```
AB#42 Add authentication middleware for API server
```

Rules:

- **`AB#XXXX` prefix** links the commit to Azure DevOps work items automatically
- **No conventional commits prefix** (`feat:`, `fix:`, etc.) -- `AB#` is the prefix
- Multiple stories in one commit: `AB#42 AB#43 Description`
- Keep the description concise and meaningful

Examples:

```
AB#85 Fix tree-sitter WASM ABI incompatibility
AB#55 AB#52 Add SSE transport and coderag_explain tool
AB#103 Fix HybridSearch returning empty metadata for vector-only results
```

### Squash Merge

- Feature branches are squash-merged to main for clean history
- No direct commits to main
- The PR title should include the AB# reference

---

## Pull Request Process

### Before Submitting

1. Run the full build and test suite:
   ```bash
   pnpm build && pnpm test && pnpm lint
   ```
2. Ensure no `any` types or unjustified `as` casts
3. Verify tests cover the new functionality (80%+ on core)
4. Update documentation if behavior changes

### Creating a PR

1. Push your branch:
   ```bash
   git push origin feature/AB#XXXX-description
   ```

2. Open a Pull Request against the `main` branch

3. Fill out the PR with:
   - **Summary** of changes (1-3 bullet points)
   - **Test plan** (how to verify the changes)
   - **AB# link** to the Azure DevOps work item

### Review Expectations

- Keep PRs focused -- one feature or fix per PR
- Include tests for new functionality
- Update documentation if behavior changes
- Ensure all CI checks pass before requesting review
- Address review feedback promptly
- Rebase on `main` if your branch falls behind

---

## Adding New Providers

CodeRAG's provider pattern makes it straightforward to add new implementations. See [docs/extending.md](docs/extending.md) for detailed guides on adding:

- **Embedding providers** (implement `EmbeddingProvider` interface)
- **Vector stores** (implement `VectorStore` interface)
- **Backlog providers** (implement `BacklogProvider` interface)
- **Language parsers** (register Tree-sitter grammars in `LanguageRegistry`)

---

## Reporting Issues

- Search existing issues before creating a new one
- For bugs: include reproduction steps, environment details (OS, Node.js version), and relevant error output
- For features: describe the use case and expected behavior
- Include the CodeRAG version (`coderag --version` or check `package.json`)

---

## License

By contributing to CodeRAG, you agree that your contributions will be licensed under the MIT License.
