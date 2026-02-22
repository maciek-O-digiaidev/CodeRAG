---
tags:
  - guide
  - contributing
  - development
  - conventions
aliases:
  - contributing
  - development-guide
  - coding-conventions
---

# Contributing to CodeRAG

This guide covers development setup, coding conventions, testing practices, and the workflow for contributing to CodeRAG.

## Development Setup

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (package manager)
- **Ollama** (for local embedding and LLM, optional for tests)

### Clone and Build

```bash
# Clone the repository
git clone https://dev.azure.com/momc-pl/CodeRAG/_git/CodeRAG
cd CodeRAG

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Project Structure

CodeRAG is a **pnpm workspace monorepo** with these packages:

```
packages/
  core/               # Core library: ingestion, embedding, retrieval
  cli/                # CLI tool (coderag init/index/search/serve/status)
  mcp-server/         # MCP server (stdio + SSE transport)
  benchmarks/         # Benchmark suite
  vscode-extension/   # VS Code extension
  api-server/         # REST API server for team/cloud deployments
  viewer/             # Web-based visualization SPA
```

Each package has its own `package.json`, `tsconfig.json`, and builds independently. Cross-package dependencies use workspace protocol (`workspace:*`).

## TypeScript Configuration

The project uses a shared `tsconfig.base.json` with strict settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

> [!warning]
> `noUncheckedIndexedAccess` is enabled. Array/object index access returns `T | undefined`, so you must handle the `undefined` case explicitly.

## Coding Conventions

### TypeScript Strict Mode

- **No `any`** -- use `unknown` and narrow with type guards
- **No `as` casts** without justification in a comment
- **ESM modules only** -- use `import`/`export`, never `require()`
- All imports must include the `.js` extension for NodeNext resolution

### Style

| Element | Convention | Example |
|---------|-----------|---------|
| Functions / variables | camelCase | `parseChunks`, `topK` |
| Types / classes | PascalCase | `SearchResult`, `DependencyGraph` |
| Constants | UPPER_SNAKE | `BATCH_SIZE`, `DEFAULT_CONFIG` |
| File names | kebab-case | `tree-sitter-parser.ts`, `hybrid-search.ts` |

### Functional Style

- Prefer **pure functions** over classes with mutable state
- Use **`readonly`** on interface properties and function parameters
- Minimize mutable state -- favor `map`/`filter`/`reduce` over loops with mutation
- Use `ReadonlyArray`, `ReadonlyMap`, `ReadonlySet` for immutable collections

### Error Handling

CodeRAG uses the **Result pattern** via [neverthrow](https://github.com/supermacro/neverthrow) instead of throwing exceptions:

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
    const parsed = JSON.parse(raw);
    return ok(parsed as Config);
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

> [!note]
> Every public function that can fail should return `Result<T, E>`. Exceptions are reserved for truly unexpected situations (programmer errors).

### Provider Pattern

All external dependencies are behind interfaces. This enables:
- Easy testing with mocks
- Swapping implementations without changing consumers
- Clear dependency boundaries

```typescript
// Define the interface
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Result<number[][], EmbedError>>;
  readonly dimensions: number;
}

// Implement it
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  // ...
}
```

Key interfaces: `EmbeddingProvider`, `VectorStore`, `BacklogProvider`, `AuthProvider`, `LLMProvider`, `Parser`, `Chunker`, `ReRanker`.

### Configuration

All configuration flows through `.coderag.yaml`. No hardcoded values for anything that could vary between environments.

## Testing

### Framework and Location

- **Vitest** is the test runner
- Tests are **co-located** with source files as `*.test.ts`
- Coverage target: **80%+** on `@coderag/core`

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
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @coderag/core test

# Run with coverage
pnpm test -- --coverage

# Run a specific test file
pnpm test -- packages/core/src/embedding/ollama-embedding-provider.test.ts
```

## Branch Strategy

```
main (protected)
  feature/AB#XXXX-short-description    (feature branches)
  bugfix/AB#XXXX-fix-description       (bugfix branches)
```

### Creating a Branch

```bash
git checkout -b feature/AB#42-add-auth-middleware
```

### Commit Message Format

Commit messages start with the Azure DevOps work item ID:

```
AB#42 Add authentication middleware for API server
```

Rules:
- **AB#XXXX** prefix links the commit to Azure DevOps work items
- No conventional commits prefix (`feat:`, `fix:`, etc.) -- `AB#` is the prefix
- Multiple stories in one commit: `AB#42 AB#43 Description`
- Keep the description concise and meaningful

### Pull Requests

- **Squash merge** to main for clean history
- PR title should include the AB# reference
- PR body should summarize changes and link to the story

## Adding a New Provider

This step-by-step guide shows how to add a new provider (e.g., a new embedding backend).

### Step 1: Define or Reuse the Interface

Check `packages/core/src/types/provider.ts` for existing interfaces. If your provider type exists (e.g., `EmbeddingProvider`), skip to Step 2.

For a new provider category, define the interface:

```typescript
// packages/core/src/types/provider.ts
export interface MyProvider {
  readonly name: string;
  initialize(config: Record<string, unknown>): Promise<Result<void, MyProviderError>>;
  doSomething(input: string): Promise<Result<Output, MyProviderError>>;
}
```

### Step 2: Create the Implementation

```bash
# Create the file (kebab-case)
touch packages/core/src/my-domain/my-new-provider.ts
```

```typescript
// packages/core/src/my-domain/my-new-provider.ts
import { ok, err, type Result } from 'neverthrow';
import type { MyProvider } from '../types/provider.js';

export interface MyNewProviderConfig {
  readonly apiKey: string;
  readonly endpoint: string;
}

export class MyNewProvider implements MyProvider {
  readonly name = 'my-new-provider';
  private readonly config: MyNewProviderConfig;

  constructor(config: MyNewProviderConfig) {
    this.config = config;
  }

  async initialize(config: Record<string, unknown>): Promise<Result<void, Error>> {
    // Validate and connect
    return ok(undefined);
  }

  async doSomething(input: string): Promise<Result<string, Error>> {
    // Implementation
    return ok(`result for ${input}`);
  }
}
```

### Step 3: Write Tests

```bash
touch packages/core/src/my-domain/my-new-provider.test.ts
```

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MyNewProvider } from './my-new-provider.js';

describe('MyNewProvider', () => {
  it('should initialize successfully', async () => {
    const provider = new MyNewProvider({ apiKey: 'test', endpoint: 'http://localhost' });
    const result = await provider.initialize({});
    expect(result.isOk()).toBe(true);
  });

  // ... more tests
});
```

### Step 4: Export from Package

Add the export to `packages/core/src/index.ts`:

```typescript
export { MyNewProvider } from './my-domain/my-new-provider.js';
export type { MyNewProviderConfig } from './my-domain/my-new-provider.js';
```

### Step 5: Wire into Configuration

Add the provider option to the config schema and factory logic so users can select it in `.coderag.yaml`.

### Step 6: Verify

```bash
pnpm build && pnpm test
```

## See Also

- [[design-decisions]] -- architectural decisions and rationale
- [[interfaces]] -- complete list of provider interfaces
- [[core]] -- core library architecture
