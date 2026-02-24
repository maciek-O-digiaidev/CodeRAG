---
tags:
  - api-reference
  - interfaces
  - providers
  - abstractions
aliases:
  - Provider Interfaces
  - Abstractions
  - Interface Reference
---

# Provider Interfaces

CodeRAG follows a strict **provider pattern**: all external dependencies are behind interfaces for easy swapping, testing, and extension. This page documents every provider interface and its known implementations.

> [!tip]
> All provider methods return `Result<T, E>` from `neverthrow` instead of throwing exceptions. This ensures errors are always handled explicitly at the call site.

---

## Parser

Parses source files using Tree-sitter WASM bindings and extracts declarations.

**Source:** `packages/core/src/types/provider.ts`

```typescript
interface Parser {
  /** Parse a single file and extract its structure. */
  parse(filePath: string, content: string): Promise<Result<ParsedFile, ParseError>>;
  /** Returns the list of languages this parser supports. */
  supportedLanguages(): string[];
}
```

### Methods

| Method                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `parse()`             | Parses a file, extracting declarations and language info |
| `supportedLanguages()`| Returns supported language identifiers                   |

### Implementations

| Class                | Package        | Description                                          |
| -------------------- | -------------- | ---------------------------------------------------- |
| `TreeSitterParser`   | `@code-rag/core`| Tree-sitter WASM parser supporting TS, JS, Python, Go, Rust, Java, C# |

---

## Chunker

Splits parsed files into semantically meaningful chunks using AST analysis rather than arbitrary line splits.

**Source:** `packages/core/src/types/provider.ts`

```typescript
interface Chunker {
  /** Split a parsed file into AST-based chunks. */
  chunk(parsed: ParsedFile): Promise<Result<Chunk[], ChunkError>>;
}
```

### Methods

| Method    | Description                                               |
| --------- | --------------------------------------------------------- |
| `chunk()` | Produces an array of `Chunk` objects from a `ParsedFile`  |

### Implementations

| Class          | Package         | Description                                        |
| -------------- | --------------- | -------------------------------------------------- |
| `ASTChunker`   | `@code-rag/core` | AST-aware chunker respecting function/class boundaries |

---

## EmbeddingProvider

Generates embedding vectors from text. Used to embed NL-enriched chunk summaries for semantic search.

**Source:** `packages/core/src/types/provider.ts`

```typescript
interface EmbeddingProvider {
  /** Generate embeddings for a batch of texts. */
  embed(texts: string[]): Promise<Result<number[][], EmbedError>>;
  /** Dimensionality of the embedding vectors. */
  readonly dimensions: number;
}
```

### Methods

| Method       | Description                                         |
| ------------ | --------------------------------------------------- |
| `embed()`    | Batch-embeds an array of strings into vectors       |
| `dimensions` | Read-only property returning the vector dimensionality |

### Implementations

| Class                      | Package         | Description                                    |
| -------------------------- | --------------- | ---------------------------------------------- |
| `OllamaEmbeddingProvider`  | `@code-rag/core` | Local embedding via Ollama (nomic-embed-text)  |

> [!note]
> The `EmbeddingConfig.provider` field in `.coderag.yaml` supports `"ollama"`, `"voyage"`, and `"openai"` as provider names. Currently `OllamaEmbeddingProvider` is the primary implementation for local-first operation.

---

## VectorStore

Stores and queries embedding vectors. Provides CRUD operations for the vector index.

**Source:** `packages/core/src/types/provider.ts`

```typescript
interface VectorStore {
  /** Insert or update vectors with metadata. */
  upsert(
    ids: string[],
    embeddings: number[][],
    metadata: Record<string, unknown>[],
  ): Promise<Result<void, StoreError>>;
  /** Query nearest neighbors for a given embedding vector. */
  query(
    embedding: number[],
    topK: number,
  ): Promise<Result<{ id: string; score: number }[], StoreError>>;
  /** Delete vectors by ID. */
  delete(ids: string[]): Promise<Result<void, StoreError>>;
  /** Return the total number of stored vectors. */
  count(): Promise<Result<number, StoreError>>;
  /** Close the store connection. */
  close(): void;
}
```

### Methods

| Method     | Description                                    |
| ---------- | ---------------------------------------------- |
| `upsert()` | Batch insert or update vectors with metadata   |
| `query()`  | Find top-K nearest neighbors                   |
| `delete()` | Remove vectors by their IDs                    |
| `count()`  | Return total stored vector count               |
| `close()`  | Release resources                              |

### Implementations

| Class           | Package         | Description                                   |
| --------------- | --------------- | --------------------------------------------- |
| `LanceDBStore`  | `@code-rag/core` | Embedded LanceDB (default, zero-infra)        |
| `QdrantStore`   | `@code-rag/core` | Qdrant vector database (remote or local)      |

---

## LLMProvider

Generates text completions. Used for NL enrichment (translating code to natural language descriptions before embedding).

**Source:** `packages/core/src/types/provider.ts`

```typescript
interface LLMProvider {
  /** Generate a text completion from a prompt. */
  generate(prompt: string): Promise<Result<string, LLMError>>;
}
```

### Methods

| Method       | Description                                  |
| ------------ | -------------------------------------------- |
| `generate()` | Produces a text completion from a prompt     |

### Implementations

| Class             | Package         | Description                                 |
| ----------------- | --------------- | ------------------------------------------- |
| `OllamaProvider`  | `@code-rag/core` | Local LLM via Ollama (qwen2.5-coder, llama3.2) |

---

## ReRanker

Re-ranks search results using a cross-encoder model for more precise relevance ordering.

**Source:** `packages/core/src/types/provider.ts`

```typescript
interface ReRanker {
  /** Re-rank search results for a given query. */
  rerank(
    query: string,
    results: SearchResult[],
  ): Promise<Result<SearchResult[], ReRankerError>>;
}
```

### Methods

| Method     | Description                                          |
| ---------- | ---------------------------------------------------- |
| `rerank()` | Re-scores and re-orders results using cross-encoding |

### Implementations

| Class                  | Package         | Description                           |
| ---------------------- | --------------- | ------------------------------------- |
| `CrossEncoderReRanker` | `@code-rag/core` | Cross-encoder re-ranker via Ollama    |

---

## BacklogProvider

Connects to a project management tool to fetch work items (epics, stories, tasks, bugs).

**Source:** `packages/core/src/backlog/backlog-provider.ts`

```typescript
interface BacklogProvider {
  /** Provider identifier (e.g., "azure-devops", "jira", "clickup"). */
  readonly name: string;
  /** Initialize the provider with its configuration. */
  initialize(config: Record<string, unknown>): Promise<Result<void, BacklogError>>;
  /** List items matching a query with optional filters. */
  getItems(query: BacklogQuery): Promise<Result<BacklogItem[], BacklogError>>;
  /** Get a single item by its provider-specific ID. */
  getItem(id: string): Promise<Result<BacklogItem, BacklogError>>;
  /** Full-text search across backlog items. */
  searchItems(text: string, limit?: number): Promise<Result<BacklogItem[], BacklogError>>;
  /** Get file paths linked to a specific work item. */
  getLinkedCode(itemId: string): Promise<Result<string[], BacklogError>>;
}
```

### Methods

| Method          | Description                                         |
| --------------- | --------------------------------------------------- |
| `initialize()`  | Validates config and establishes provider connection |
| `getItems()`    | Lists items matching a `BacklogQuery`                |
| `getItem()`     | Fetches a single item by ID                         |
| `searchItems()` | Full-text search with optional limit                 |
| `getLinkedCode()`| Returns file paths linked to a work item            |

### Implementations

| Class                  | Package         | Provider        | Description                              |
| ---------------------- | --------------- | --------------- | ---------------------------------------- |
| `AzureDevOpsProvider`  | `@code-rag/core` | Azure DevOps    | ADO REST API with WIQL queries           |
| `JiraProvider`         | `@code-rag/core` | Jira            | Jira REST API with JQL queries           |
| `ClickUpProvider`      | `@code-rag/core` | ClickUp         | ClickUp API v2                           |

> [!example]
> Configuration in `.coderag.yaml`:
> ```yaml
> backlog:
>   provider: azure-devops
>   config:
>     organization: my-org
>     project: my-project
>     pat: ${ADO_PAT}
> ```

---

## AuthProvider

Authenticates users and resolves their roles and repository access. Used by the [[api-server]] for enterprise authentication.

**Source:** `packages/core/src/auth/types.ts`

```typescript
interface AuthProvider {
  /** Provider identifier (e.g., "oidc", "saml"). */
  readonly name: string;
  /** Validate a token and return the decoded auth claims. */
  authenticate(token: string): Promise<Result<AuthToken, AuthError>>;
  /** Get roles assigned to a user. */
  getUserRoles(userId: string): Promise<Result<readonly Role[], AuthError>>;
  /** Get repository names a user has access to. */
  getUserRepos(userId: string): Promise<Result<readonly string[], AuthError>>;
}
```

### Methods

| Method            | Description                                       |
| ----------------- | ------------------------------------------------- |
| `authenticate()`  | Validates a JWT/SAML token, returns `AuthToken`   |
| `getUserRoles()`  | Returns roles for a user ID                       |
| `getUserRepos()`  | Returns allowed repository names for a user       |

### Implementations

| Class            | Package         | Protocol | Description                                   |
| ---------------- | --------------- | -------- | --------------------------------------------- |
| `OIDCProvider`   | `@code-rag/core` | OIDC     | OpenID Connect with JWKS validation (zero external deps) |
| `SAMLProvider`   | `@code-rag/core` | SAML 2.0 | SAML assertion parsing with XML signature validation     |

> [!note]
> Both auth providers are implemented with zero external dependencies -- JWKS fetching, JWT decoding, XML parsing, and signature verification are all done with Node.js built-in `crypto` module.

### Related Config Types

```typescript
interface OIDCConfig {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: string;
  readonly roleMapping?: Readonly<Record<string, Role>>;
}

interface SAMLConfig {
  readonly idpMetadataUrl: string;
  readonly spEntityId: string;
  readonly spAcsUrl: string;
  readonly certificatePem: string;
  readonly roleMapping?: Readonly<Record<string, Role>>;
}
```

---

## CloudStorageProvider

Provider-agnostic interface for cloud object storage. Used for team-shared index synchronization.

**Source:** `packages/core/src/storage/types.ts`

```typescript
interface CloudStorageProvider {
  /** Upload data to the given key. */
  upload(key: string, data: Buffer): Promise<Result<void, StorageError>>;
  /** Download data from the given key. */
  download(key: string): Promise<Result<Buffer, StorageError>>;
  /** Delete the object at the given key. */
  delete(key: string): Promise<Result<void, StorageError>>;
  /** List object keys matching a prefix. */
  list(prefix: string): Promise<Result<readonly string[], StorageError>>;
  /** Check whether an object exists at the given key. */
  exists(key: string): Promise<Result<boolean, StorageError>>;
  /** Get a URL (or presigned URL) for the given key. */
  getUrl(key: string): Result<string, StorageError>;
}
```

### Methods

| Method       | Description                                           |
| ------------ | ----------------------------------------------------- |
| `upload()`   | Stores a `Buffer` at the specified key                |
| `download()` | Retrieves a `Buffer` from the specified key           |
| `delete()`   | Removes the object at the key                         |
| `list()`     | Lists all keys matching a prefix                      |
| `exists()`   | Checks if an object exists (returns boolean)          |
| `getUrl()`   | Returns a URL for the object (synchronous)            |

### Implementations

| Class                    | Package         | Provider     | Description                                    |
| ------------------------ | --------------- | ------------ | ---------------------------------------------- |
| `S3StorageProvider`      | `@code-rag/core` | AWS S3       | S3 + S3-compatible (MinIO) with AWS Sig V4     |
| `AzureBlobProvider`      | `@code-rag/core` | Azure Blob   | Azure Blob Storage with SharedKey auth         |
| `GCSStorageProvider`     | `@code-rag/core` | Google Cloud | GCS with service account JWT auth              |

> [!note]
> All three cloud storage providers are implemented with zero external SDK dependencies. They use Node.js built-in `crypto` and `https` modules for authentication and HTTP requests.

### Related Config Types

```typescript
interface S3Config {
  readonly provider: 's3';
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly endpoint?: string;  // For S3-compatible stores (MinIO)
}

interface AzureBlobConfig {
  readonly provider: 'azure-blob';
  readonly accountName: string;
  readonly accountKey: string;
  readonly containerName: string;
}

interface GCSConfig {
  readonly provider: 'gcs';
  readonly projectId: string;
  readonly bucket: string;
  readonly credentials: GCSCredentials;
}

/** Discriminated union of all cloud storage configs. */
type CloudStorageConfig = S3Config | AzureBlobConfig | GCSConfig;
```

---

## DocsProvider

Fetches documentation from external systems for indexing. Currently used for Confluence and SharePoint.

**Source:** `packages/core/src/docs/confluence-provider.ts`

```typescript
interface DocsProvider {
  /** Provider identifier (e.g., "confluence", "sharepoint"). */
  readonly name: string;
  /** Initialize the provider with its configuration. */
  initialize(config: Record<string, unknown>): Promise<Result<void, ConfluenceError>>;
  /** Fetch all pages from specified spaces. */
  fetchPages(spaceKeys?: string[]): Promise<Result<ConfluencePage[], ConfluenceError>>;
  /** Fetch a single page by its ID. */
  fetchPage(pageId: string): Promise<Result<ConfluencePage, ConfluenceError>>;
  /** Fetch all blog posts from specified spaces. */
  fetchBlogPosts(spaceKeys?: string[]): Promise<Result<ConfluencePage[], ConfluenceError>>;
  /** Fetch comments for a specific page. */
  fetchComments(pageId: string): Promise<Result<ConfluencePage[], ConfluenceError>>;
  /** Get pages changed since a given date (for incremental sync). */
  getChangedPages(since: Date): Promise<Result<ConfluenceChangedItem[], ConfluenceError>>;
}
```

### Methods

| Method             | Description                                              |
| ------------------ | -------------------------------------------------------- |
| `initialize()`     | Validates config and tests the provider connection       |
| `fetchPages()`     | Fetches all pages, optionally filtered by space keys     |
| `fetchPage()`      | Fetches a single page by ID                              |
| `fetchBlogPosts()` | Fetches blog posts from specified spaces                 |
| `fetchComments()`  | Fetches comments attached to a specific page             |
| `getChangedPages()`| Returns items modified since a date (incremental sync)   |

### Implementations

| Class                | Package         | Provider     | Description                                        |
| -------------------- | --------------- | ------------ | -------------------------------------------------- |
| `ConfluenceProvider` | `@code-rag/core` | Confluence   | REST API v2 with Basic/OAuth auth, XHTML-to-text   |
| `SharePointProvider` | `@code-rag/core` | SharePoint   | MS Graph API with OAuth2 client credentials, .docx/.pdf extraction |

> [!warning]
> The `SharePointProvider` uses a lightweight zero-dependency text extractor for `.docx` and `.pdf` files. It handles common cases but may miss content in complex documents with compressed streams or CMap-encoded PDFs.

---

## ReadonlyGraph

A read-only view of the dependency graph, used for dependency inversion in the retrieval pipeline. The `ContextExpander` depends on this interface rather than the concrete `DependencyGraph` class.

**Source:** `packages/core/src/retrieval/context-expander.ts`

```typescript
interface ReadonlyGraph {
  /** Get a node by its ID. */
  getNode(id: string): GraphNode | undefined;
  /** Get all outgoing edges from a node. */
  getEdges(nodeId: string): GraphEdge[];
  /** Get all incoming edges to a node. */
  getIncomingEdges(nodeId: string): GraphEdge[];
}
```

### Methods

| Method              | Description                                    |
| ------------------- | ---------------------------------------------- |
| `getNode()`         | Returns a `GraphNode` or `undefined`           |
| `getEdges()`        | Returns outgoing edges (dependencies)          |
| `getIncomingEdges()`| Returns incoming edges (dependents)            |

### Implementations

| Class              | Package         | Description                                     |
| ------------------ | --------------- | ----------------------------------------------- |
| `DependencyGraph`  | `@code-rag/core` | Full mutable graph with BFS traversal, serialization |

> [!tip]
> The `ReadonlyGraph` interface enables testing with mock graphs and prevents the retrieval pipeline from mutating the graph during context expansion.

---

## Interface Dependency Map

The following diagram shows which interfaces are consumed by which components:

| Consumer                    | Interfaces Used                                              |
| --------------------------- | ------------------------------------------------------------ |
| Ingestion Pipeline          | `Parser`, `Chunker`, `LLMProvider`, `EmbeddingProvider`      |
| Hybrid Search               | `VectorStore`, `EmbeddingProvider`                           |
| Context Expander            | `ReadonlyGraph`                                              |
| Cross-Encoder Re-Ranker     | `ReRanker`                                                   |
| MCP Server (coderag_backlog)| `BacklogProvider`                                            |
| MCP Server (coderag_docs)   | `ReRanker`                                                   |
| API Server (team routes)    | `CloudStorageProvider`                                       |
| API Server (auth middleware)| `AuthProvider`                                               |

---

## See Also

- [[types]] -- Full type definitions for `Chunk`, `SearchResult`, `BacklogItem`, etc.
- [[design-decisions]] -- Architecture decisions behind the provider pattern
- [[core]] -- Core package documentation
