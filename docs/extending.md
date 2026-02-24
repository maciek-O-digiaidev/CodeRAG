# Extending CodeRAG

This guide explains how to extend CodeRAG with new providers and parsers. All external dependencies sit behind interfaces (the "provider pattern"), so adding a new embedding backend, vector store, backlog provider, or language parser follows a consistent workflow.

---

## Table of Contents

- [General Workflow](#general-workflow)
- [Adding an Embedding Provider](#adding-an-embedding-provider)
- [Adding a Vector Store](#adding-a-vector-store)
- [Adding a Backlog Provider](#adding-a-backlog-provider)
- [Adding a Language Parser](#adding-a-language-parser)
- [Wiring into Configuration](#wiring-into-configuration)

---

## General Workflow

Every extension follows these steps:

1. **Identify the interface** in `packages/core/src/types/provider.ts` (or `packages/core/src/backlog/backlog-provider.ts` for backlog providers)
2. **Create a new file** in the appropriate directory (kebab-case naming)
3. **Implement the interface**, using the `Result<T, E>` pattern from neverthrow
4. **Write co-located tests** (`*.test.ts` next to the source file)
5. **Export from the package** index
6. **Wire into configuration** so users can select the provider in `.coderag.yaml`
7. **Run `pnpm build && pnpm test`** to verify

---

## Adding an Embedding Provider

The `EmbeddingProvider` interface abstracts how text is converted into vector embeddings.

### Interface

```typescript
// packages/core/src/types/provider.ts

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Result<number[][], EmbedError>>;
  readonly dimensions: number;
}
```

| Method | Description |
|--------|-------------|
| `embed(texts)` | Convert an array of text strings into an array of embedding vectors. Each vector has length `dimensions`. |
| `dimensions` | The number of dimensions in each embedding vector. Must match the model's actual output. |

### Minimal Implementation

Create `packages/core/src/embedding/my-embedding-provider.ts`:

```typescript
import { ok, err, type Result } from 'neverthrow';
import { EmbedError, type EmbeddingProvider } from '../types/provider.js';

export interface MyEmbeddingConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
}

export class MyEmbeddingProvider implements EmbeddingProvider {
  private readonly config: MyEmbeddingConfig;

  constructor(config: MyEmbeddingConfig) {
    this.config = config;
  }

  get dimensions(): number {
    return this.config.dimensions;
  }

  async embed(texts: string[]): Promise<Result<number[][], EmbedError>> {
    // Handle empty input
    if (texts.length === 0) {
      return ok([]);
    }

    try {
      // Call your embedding API
      const response = await fetch('https://api.example.com/embed', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        return err(new EmbedError(
          `API returned ${response.status}: ${response.statusText}`
        ));
      }

      const data = await response.json() as { embeddings: number[][] };
      return ok(data.embeddings);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new EmbedError(`Embedding request failed: ${message}`));
    }
  }
}
```

### Key Requirements

- Return `Result<number[][], EmbedError>` using neverthrow -- never throw exceptions
- Handle empty input arrays by returning `ok([])`
- The `dimensions` property must match the model's actual output dimensions
- Handle batching internally if the upstream API has size limits (see `OllamaEmbeddingProvider` for an example that batches in groups of 50)
- Validate response shapes before returning

### Test File

Create `packages/core/src/embedding/my-embedding-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MyEmbeddingProvider } from './my-embedding-provider.js';

describe('MyEmbeddingProvider', () => {
  let provider: MyEmbeddingProvider;

  beforeEach(() => {
    provider = new MyEmbeddingProvider({
      apiKey: 'test-key',
      model: 'test-model',
      dimensions: 256,
    });
  });

  it('should return the configured dimensions', () => {
    expect(provider.dimensions).toBe(256);
  });

  it('should return ok([]) for empty input', async () => {
    const result = await provider.embed([]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('should return embeddings for valid input', async () => {
    // Mock the fetch call
    const mockEmbedding = [new Array(256).fill(0.1)];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ embeddings: mockEmbedding }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await provider.embed(['hello world']);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(result._unsafeUnwrap()[0]).toHaveLength(256);
  });

  it('should return EmbedError on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const result = await provider.embed(['hello']);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('500');
  });
});
```

### Existing Implementations

For reference, see these existing embedding providers:

- `packages/core/src/embedding/ollama-embedding-provider.ts` -- local Ollama with batching
- `docs/guides/embedding-providers.md` -- configuration guide for Ollama, Voyage, and OpenAI

---

## Adding a Vector Store

The `VectorStore` interface abstracts vector storage and similarity search.

### Interface

```typescript
// packages/core/src/types/provider.ts

export interface VectorStore {
  upsert(
    ids: string[],
    embeddings: number[][],
    metadata: Record<string, unknown>[],
  ): Promise<Result<void, StoreError>>;

  query(
    embedding: number[],
    topK: number,
  ): Promise<Result<{ id: string; score: number; metadata?: Record<string, unknown> }[], StoreError>>;

  delete(ids: string[]): Promise<Result<void, StoreError>>;

  count(): Promise<Result<number, StoreError>>;

  close(): void;
}
```

| Method | Description |
|--------|-------------|
| `upsert(ids, embeddings, metadata)` | Insert or update vectors with their IDs and metadata |
| `query(embedding, topK)` | Find the `topK` most similar vectors to the given embedding |
| `delete(ids)` | Remove vectors by their IDs |
| `count()` | Return the total number of stored vectors |
| `close()` | Clean up resources (connections, file handles) |

### Minimal Implementation

Create `packages/core/src/embedding/my-vector-store.ts`:

```typescript
import { ok, err, type Result } from 'neverthrow';
import { StoreError, type VectorStore } from '../types/provider.js';

export interface MyVectorStoreConfig {
  readonly connectionString: string;
  readonly collectionName: string;
}

export class MyVectorStore implements VectorStore {
  private readonly config: MyVectorStoreConfig;

  constructor(config: MyVectorStoreConfig) {
    this.config = config;
  }

  async upsert(
    ids: string[],
    embeddings: number[][],
    metadata: Record<string, unknown>[],
  ): Promise<Result<void, StoreError>> {
    if (ids.length !== embeddings.length || ids.length !== metadata.length) {
      return err(new StoreError('ids, embeddings, and metadata must have the same length'));
    }

    try {
      // Your upsert logic here -- e.g., batch insert into a database
      // ...
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`Upsert failed: ${message}`));
    }
  }

  async query(
    embedding: number[],
    topK: number,
  ): Promise<Result<{ id: string; score: number; metadata?: Record<string, unknown> }[], StoreError>> {
    try {
      // Your similarity search logic here
      // Return results sorted by score descending
      const results: { id: string; score: number; metadata?: Record<string, unknown> }[] = [];
      // ...
      return ok(results);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`Query failed: ${message}`));
    }
  }

  async delete(ids: string[]): Promise<Result<void, StoreError>> {
    if (ids.length === 0) {
      return ok(undefined);
    }

    try {
      // Your delete logic here
      // ...
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`Delete failed: ${message}`));
    }
  }

  async count(): Promise<Result<number, StoreError>> {
    try {
      // Your count logic here
      const count = 0;
      return ok(count);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new StoreError(`Count failed: ${message}`));
    }
  }

  close(): void {
    // Clean up connections, file handles, etc.
  }
}
```

### Key Requirements

- All mutation methods (`upsert`, `delete`) must be idempotent
- `query` results must be sorted by similarity score, descending
- `close()` is synchronous -- release resources without async cleanup
- Validate input lengths in `upsert` (ids, embeddings, metadata must match)
- Handle empty input arrays gracefully

### Existing Implementations

- `packages/core/src/embedding/lancedb-store.ts` -- LanceDB (embedded, file-based)
- `packages/core/src/embedding/qdrant-store.ts` -- Qdrant (client-server)

---

## Adding a Backlog Provider

The `BacklogProvider` interface abstracts project management tool integration (Azure DevOps, Jira, ClickUp, etc.).

### Interface

```typescript
// packages/core/src/backlog/backlog-provider.ts

export interface BacklogProvider {
  readonly name: string;
  initialize(config: Record<string, unknown>): Promise<Result<void, BacklogError>>;
  getItems(query: BacklogQuery): Promise<Result<BacklogItem[], BacklogError>>;
  getItem(id: string): Promise<Result<BacklogItem, BacklogError>>;
  searchItems(text: string, limit?: number): Promise<Result<BacklogItem[], BacklogError>>;
  getLinkedCode(itemId: string): Promise<Result<string[], BacklogError>>;
}
```

### Supporting Types

```typescript
// packages/core/src/backlog/types.ts

export type BacklogItemType = 'epic' | 'story' | 'task' | 'bug' | 'feature';

export interface BacklogItem {
  id: string;
  externalId: string;       // Provider-specific ID (e.g., "AB#123", "PROJ-456")
  title: string;
  description: string;
  type: BacklogItemType;
  state: string;             // e.g., "New", "Active", "Resolved", "Closed"
  assignedTo?: string;
  tags: string[];
  linkedCodePaths: string[]; // File paths linked to this item
  url?: string;              // Web URL to view the item
  metadata: Record<string, unknown>;
}

export interface BacklogQuery {
  text?: string;
  types?: BacklogItemType[];
  states?: string[];
  assignedTo?: string;
  tags?: string[];
  limit?: number;
}
```

### Minimal Implementation

Create `packages/core/src/backlog/my-backlog-provider.ts`:

```typescript
import { ok, err, type Result } from 'neverthrow';
import { BacklogError, type BacklogProvider } from './backlog-provider.js';
import type { BacklogItem, BacklogQuery } from './types.js';

export interface MyBacklogConfig {
  readonly baseUrl: string;
  readonly apiToken: string;
  readonly projectId: string;
}

export class MyBacklogProvider implements BacklogProvider {
  readonly name = 'my-tracker';
  private config: MyBacklogConfig | null = null;

  async initialize(config: Record<string, unknown>): Promise<Result<void, BacklogError>> {
    const baseUrl = config['baseUrl'];
    const apiToken = config['apiToken'];
    const projectId = config['projectId'];

    if (typeof baseUrl !== 'string' || typeof apiToken !== 'string' || typeof projectId !== 'string') {
      return err(new BacklogError('Missing required config: baseUrl, apiToken, projectId'));
    }

    this.config = { baseUrl, apiToken, projectId };
    return ok(undefined);
  }

  async getItems(query: BacklogQuery): Promise<Result<BacklogItem[], BacklogError>> {
    if (!this.config) {
      return err(new BacklogError('Provider not initialized'));
    }

    try {
      // Call your project management API
      // Map response to BacklogItem[]
      const items: BacklogItem[] = [];
      // ...
      return ok(items);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new BacklogError(`Failed to get items: ${message}`));
    }
  }

  async getItem(id: string): Promise<Result<BacklogItem, BacklogError>> {
    if (!this.config) {
      return err(new BacklogError('Provider not initialized'));
    }

    try {
      // Fetch a single item by ID
      // Map response to BacklogItem
      return err(new BacklogError(`Item not found: ${id}`));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new BacklogError(`Failed to get item ${id}: ${message}`));
    }
  }

  async searchItems(text: string, limit = 20): Promise<Result<BacklogItem[], BacklogError>> {
    // Full-text search across items
    return this.getItems({ text, limit });
  }

  async getLinkedCode(itemId: string): Promise<Result<string[], BacklogError>> {
    if (!this.config) {
      return err(new BacklogError('Provider not initialized'));
    }

    try {
      // Return file paths associated with this work item
      const paths: string[] = [];
      // ...
      return ok(paths);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new BacklogError(`Failed to get linked code for ${itemId}: ${message}`));
    }
  }
}
```

### Key Requirements

- The `name` property should be a kebab-case identifier (e.g., `'azure-devops'`, `'jira'`, `'clickup'`)
- `initialize()` must validate configuration and return an error for missing/invalid fields
- All methods must check that the provider has been initialized
- Map provider-specific item types to the `BacklogItemType` union (`'epic' | 'story' | 'task' | 'bug' | 'feature'`)
- Populate `externalId` with the provider-native ID format (e.g., `'AB#123'` for ADO, `'PROJ-456'` for Jira)
- Set `url` to the web URL where the item can be viewed

### Existing Implementations

- `packages/core/src/backlog/azure-devops-provider.ts` -- Azure DevOps
- `packages/core/src/backlog/jira-provider.ts` -- Jira
- `packages/core/src/backlog/clickup-provider.ts` -- ClickUp

---

## Adding a Language Parser

Tree-sitter grammars are registered in the `LanguageRegistry`. To add a new language, you need to:

1. Add the WASM grammar package as a dependency
2. Register the language in `LanguageRegistry` maps
3. Define declaration node types for the language

### Step 1: Add the Grammar Package

Tree-sitter grammars are distributed as WASM files via the `tree-sitter-wasms` npm package. Check if the language is already included. If not, you may need to compile the grammar to WASM.

### Step 2: Register in LanguageRegistry

Edit `packages/core/src/parser/language-registry.ts`:

```typescript
// 1. Add to SupportedLanguage type
export type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  // ... existing languages ...
  | 'swift';   // <-- Add your language

// 2. Add file extension mappings
export const EXTENSION_TO_LANGUAGE: ReadonlyMap<string, SupportedLanguage> = new Map([
  // ... existing mappings ...
  ['.swift', 'swift'],
]);

// 3. Add WASM filename mapping
export const LANGUAGE_TO_WASM: ReadonlyMap<SupportedLanguage, string> = new Map([
  // ... existing mappings ...
  ['swift', 'tree-sitter-swift.wasm'],
]);

// 4. Add declaration node types
export const DECLARATION_NODE_TYPES: ReadonlyMap<SupportedLanguage, ReadonlySet<string>> = new Map([
  // ... existing mappings ...
  [
    'swift',
    new Set([
      'function_declaration',
      'class_declaration',
      'struct_declaration',
      'enum_declaration',
      'protocol_declaration',
      'extension_declaration',
    ]),
  ],
]);
```

### How Declaration Node Types Work

The `DECLARATION_NODE_TYPES` map tells the parser which AST node types represent top-level declarations for each language. When parsing a file, the `TreeSitterParser`:

1. Walks the top-level children of the root AST node
2. Checks if each child's `type` is in the language's declaration set
3. Extracts the declaration name using field access strategies: `name`, `declaration.name`, `declarator.name`

To find the correct node types for your language:

1. Parse a sample file with the Tree-sitter CLI: `tree-sitter parse sample.swift`
2. Look at the node types of top-level declarations in the output
3. Add those types to the set

### Step 3: Write Tests

Create a test that parses a sample file in your new language:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TreeSitterParser } from './tree-sitter-parser.js';

describe('TreeSitterParser (Swift)', () => {
  let parser: TreeSitterParser;

  beforeAll(async () => {
    parser = new TreeSitterParser();
    await parser.initialize();
  });

  afterAll(() => {
    parser.dispose();
  });

  it('should detect swift language from .swift extension', () => {
    // Access the registry through the parser's supportedLanguages
    expect(parser.supportedLanguages()).toContain('swift');
  });

  it('should parse a Swift file and extract declarations', async () => {
    const content = `
func greet(name: String) -> String {
    return "Hello, \\(name)!"
}

class Person {
    var name: String
    init(name: String) {
        self.name = name
    }
}
`;
    const result = await parser.parse('example.swift', content);
    expect(result.isOk()).toBe(true);

    const parsed = result._unsafeUnwrap();
    expect(parsed.language).toBe('swift');
    expect(parsed.declarations).toContain('greet');
    expect(parsed.declarations).toContain('Person');
  });
});
```

### Existing Language Support

The following 12 languages are currently supported:

| Language | Extensions | WASM Grammar |
|----------|-----------|--------------|
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | `tree-sitter-javascript.wasm` |
| TypeScript | `.ts`, `.mts`, `.cts` | `tree-sitter-typescript.wasm` |
| TSX | `.tsx` | `tree-sitter-tsx.wasm` |
| Python | `.py`, `.pyw` | `tree-sitter-python.wasm` |
| Go | `.go` | `tree-sitter-go.wasm` |
| Rust | `.rs` | `tree-sitter-rust.wasm` |
| Java | `.java` | `tree-sitter-java.wasm` |
| C# | `.cs` | `tree-sitter-c_sharp.wasm` |
| C | `.c`, `.h` | `tree-sitter-c.wasm` |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx` | `tree-sitter-cpp.wasm` |
| Ruby | `.rb` | `tree-sitter-ruby.wasm` |
| PHP | `.php` | `tree-sitter-php.wasm` |

---

## Wiring into Configuration

After implementing a new provider, you need to make it selectable via `.coderag.yaml`.

### Step 1: Update the Config Schema

Edit `packages/core/src/config/` to add your provider as an option in the relevant config section. For example, to add a new embedding provider:

```yaml
# .coderag.yaml
embedding:
  provider: my-provider    # Your new provider identifier
  model: my-model
  dimensions: 256
```

### Step 2: Update the Factory

Add your provider to the factory function that creates provider instances based on configuration:

```typescript
function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'ollama':
      return new OllamaEmbeddingProvider(/* ... */);
    case 'my-provider':
      return new MyEmbeddingProvider(/* ... */);
    default:
      // This is a programmer error (invalid config value that passed validation),
      // not a runtime error, so throwing is appropriate here.
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}
```

### Step 3: Export from Package

Add the export to `packages/core/src/index.ts` (or the relevant barrel file):

```typescript
export { MyEmbeddingProvider } from './embedding/my-embedding-provider.js';
export type { MyEmbeddingConfig } from './embedding/my-embedding-provider.js';
```

### Step 4: Verify

```bash
pnpm build && pnpm test
```

---

## Further Reading

- `CONTRIBUTING.md` -- Development setup and coding conventions
- `docs/architecture.md` -- System architecture overview
- `docs/guides/embedding-providers.md` -- Existing embedding provider configuration
- `packages/core/src/types/provider.ts` -- All provider interfaces
- `packages/core/src/backlog/backlog-provider.ts` -- BacklogProvider interface
- `packages/core/src/parser/language-registry.ts` -- Language registration maps
