---
tags:
  - architecture
  - adr
  - decisions
  - design
aliases:
  - Design Decisions
  - ADR
  - Architecture Decision Records
---

# Design Decisions

This page documents the key architectural decisions in CodeRAG using an ADR (Architecture Decision Record) style. Each decision includes the context that motivated it, the decision itself, the rationale, and known trade-offs.

---

## 1. NL Enrichment Before Embedding {#nl-enrichment}

**Status**: Accepted

### Context

Embedding models (nomic-embed-text, voyage-code-3, text-embedding-3-small) are primarily trained on natural language corpora. Raw source code contains syntactic constructs, variable names, and formatting that do not map well to the embedding space.

Greptile's research demonstrated a **10x improvement** in retrieval quality when code is first summarized in natural language before embedding.

### Decision

Every code chunk passes through an NL enrichment stage (`NLEnricher`) that uses an LLM (Ollama with qwen2.5-coder or llama3.2) to generate a one-sentence natural language summary. This summary is stored in the `nlSummary` field and is used alongside the code content for embedding.

### Rationale

- Natural language descriptions bridge the vocabulary gap between how developers phrase queries and how code is written
- The NL summary captures the "what" (purpose) rather than the "how" (implementation), which matches how agents typically query
- BM25 index boosts `nlSummary` at 2x weight, further leveraging the enriched descriptions

### Trade-offs

| Pro | Con |
|-----|-----|
| 10x retrieval quality improvement | Adds indexing latency (LLM call per chunk) |
| Better semantic matching for NL queries | Requires Ollama running during indexing |
| BM25 benefits from NL vocabulary | NL summary quality depends on LLM quality |
| Query-code vocabulary gap is bridged | Increases storage per chunk |

> **Note: Enrichment failures are intentionally non-fatal. If Ollama is unavailable, chunks proceed with an empty `nlSummary`. The index remains functional, just with lower retrieval quality.**

See [Ingestion Pipeline](ingestion-pipeline.md#stage-4:-nl-enrichment) for implementation details.

---

## 2. AST-Based Chunking Over Line-Based {#ast-chunking}

**Status**: Accepted

### Context

Chunking determines the fundamental unit of retrieval. Naive approaches split files at fixed line counts (e.g., every 100 lines) or by character count. This breaks semantic boundaries: a function split in half produces two meaningless fragments that match poorly against queries.

### Decision

Use Tree-sitter to parse source files into ASTs and chunk along declaration boundaries. Each top-level declaration (function, class, interface, type) becomes its own chunk. The `ASTChunker` maps declarations to their line ranges and creates one chunk per declaration.

### Rationale

- Each chunk is a self-contained semantic unit with a clear name and purpose
- Chunk types (`function`, `class`, `interface`, `type_alias`) can be used as search filters
- Declaration names serve as strong keyword signals for BM25
- Large declarations are split at logical points (blank lines, closing braces) rather than mid-statement

### Trade-offs

| Pro | Con |
|-----|-----|
| Semantically meaningful chunks | Requires a parser per language |
| Named chunks improve search precision | Tree-sitter WASM initialization adds startup cost |
| Chunk types enable filtering | Very small declarations produce tiny chunks |
| Deterministic chunk IDs (SHA-256) | File-level context (imports, comments) needs separate handling |

> **Warning: The `ASTChunker` falls back to a "module" chunk wrapping the entire file when no declarations can be detected. This handles configuration files, markdown, and other non-code content.**

See [Ingestion Pipeline](ingestion-pipeline.md#stage-3:-ast-based-chunking) for implementation details.

---

## 3. Hybrid Search (Vector + BM25) Over Pure Vector {#hybrid-search}

**Status**: Accepted

### Context

Pure vector search misses exact identifier matches. A query for "TreeSitterParser" may return semantically similar but wrong classes because the embedding space cannot distinguish precise naming. Conversely, pure keyword search cannot understand that "authentication handler" should match `loginController`.

### Decision

Combine vector search (LanceDB cosine similarity) and BM25 keyword search (MiniSearch) using Reciprocal Rank Fusion (RRF) with `k=60`.

### Rationale

- Documents found by both methods receive boosted scores, indicating high confidence
- RRF is rank-based and requires no score normalization between methods
- Vector search covers semantic understanding; BM25 covers exact matches
- The BM25 index adds negligible overhead (in-memory, <5ms per query)

### Trade-offs

| Pro | Con |
|-----|-----|
| Best of both worlds (semantic + keyword) | Two indices to maintain (vector + BM25) |
| Robust to query style variation | Slightly higher memory usage |
| RRF needs no score calibration | Configuration of weights may need tuning |
| Proven approach in information retrieval | BM25 index must be serialized/restored |

See [Hybrid Search](hybrid-search.md) for the full algorithm and formula.

---

## 4. Graph Expansion for Context Assembly {#graph-expansion}

**Status**: Accepted

### Context

Search results alone often lack context. Finding a function is useful, but understanding it requires seeing its tests, the interfaces it implements, and the callers that invoke it. An agent needs this surrounding context to generate accurate code.

### Decision

After hybrid search, use the [Dependency Graph](dependency-graph.md) to perform a BFS expansion (max depth 2) from each primary result. Related nodes are classified by relationship type (`imports`, `imported_by`, `test_for`, `interface_of`, `sibling`) and included in the context.

### Rationale

- Tests reveal expected behavior and edge cases
- Interfaces define the contract a function must fulfill
- Callers show how a function is actually used
- Siblings provide module-level context
- BFS with depth 2 captures immediate and transitive relationships without explosion

### Trade-offs

| Pro | Con |
|-----|-----|
| Rich context for AI agents | Graph must be built and maintained |
| Discovers related tests automatically | Depth 2 may include noise for highly connected nodes |
| Surfaces interfaces and contracts | Adds latency for graph traversal |
| Graph excerpt aids understanding | Related chunks compete for token budget |

> **Tip: The `maxRelated` parameter (default 10) caps the number of related chunks to prevent graph explosion in highly connected codebases.**

See [Retrieval Pipeline](retrieval-pipeline.md#stage-3:-context-expansion) for implementation details.

---

## 5. Token Budget Optimization {#token-budget}

**Status**: Accepted

### Context

AI agents have finite context windows. Returning all search results plus all related chunks would exceed token limits. Context must be curated and prioritized to fit within the budget while maximizing information density.

### Decision

The `TokenBudgetOptimizer` allocates the available token budget across three sections with a 60/30/10 split:

| Section | Weight | Purpose |
|---------|:------:|---------|
| Primary results | 60% | Highest-relevance search results |
| Related context | 30% | Graph-expanded related code |
| Graph excerpt | 10% | Textual dependency map |

Items are greedily added in priority order until each section's budget is exhausted.

### Rationale

- Primary results are most likely to answer the query directly
- Related context provides the "why" and "how" surrounding the answer
- The graph excerpt gives the agent a structural map for navigation
- Greedy filling is simple, predictable, and fast
- The 60/30/10 split is configurable for different use cases

### Trade-offs

| Pro | Con |
|-----|-----|
| Predictable output size | Greedy approach may not be globally optimal |
| Configurable allocation | Token estimation is approximate (length/4) |
| Respects agent token limits | Last item in each section may be partially useful but excluded |
| Prevents context overflow | Fixed allocation may waste budget if one section is sparse |

> **Info: Token estimation uses `text.length / 4`. This is a fast heuristic that avoids importing a tokenizer library. It is reasonably accurate for English text and code, but may under-count for non-ASCII content.**

See [Retrieval Pipeline](retrieval-pipeline.md#stage-5:-token-budget-optimization) for implementation details.

---

## 6. Provider Pattern for All External Dependencies {#provider-pattern}

**Status**: Accepted

### Context

CodeRAG integrates with multiple external systems: embedding models (Ollama, OpenAI, Voyage), vector databases (LanceDB, Qdrant), backlog tools (ADO, Jira, ClickUp), document sources (Confluence, SharePoint), and LLMs for enrichment/re-ranking.

### Decision

All external dependencies sit behind TypeScript interfaces. Concrete implementations are injected at configuration time.

### Key Interfaces

```typescript
interface EmbeddingProvider {
  embed(texts: string[]): Promise<Result<number[][], EmbedError>>;
}

interface VectorStore {
  upsert(items: VectorItem[]): Promise<Result<void, StoreError>>;
  query(embedding: number[], topK: number): Promise<Result<VectorResult[], StoreError>>;
}

interface ReRanker {
  rerank(query: string, results: SearchResult[]): Promise<Result<SearchResult[], ReRankerError>>;
}

interface BacklogProvider {
  getItems(query: BacklogQuery): Promise<Result<BacklogItem[], BacklogError>>;
}

interface Parser {
  parse(filePath: string, content: string): Promise<Result<ParsedFile, ParseError>>;
}

interface Chunker {
  chunk(parsed: ParsedFile): Promise<Result<Chunk[], ChunkError>>;
}
```

### Rationale

- Swap providers without changing business logic (e.g., Ollama to OpenAI)
- Test with mock implementations
- Support multiple backends simultaneously (e.g., Ollama locally, OpenAI in CI)
- Configuration-driven provider selection via `.coderag.yaml`

### Trade-offs

| Pro | Con |
|-----|-----|
| Easy to add new providers | More interfaces to maintain |
| Testable with mocks | Indirection adds a layer of abstraction |
| Configuration-driven swapping | Must ensure interface compatibility |
| Clean dependency inversion | Initial setup requires more wiring code |

---

## 7. Local-First Architecture {#local-first}

**Status**: Accepted

### Context

AI coding agents operate on proprietary codebases. Sending code to cloud services raises security, compliance, and privacy concerns. Many enterprise environments restrict outbound network access.

### Decision

CodeRAG works entirely offline by default:

| Component | Local Implementation |
|-----------|---------------------|
| Embedding | Ollama + nomic-embed-text |
| Vector DB | LanceDB (file-based, embedded) |
| NL Enrichment | Ollama (qwen2.5-coder / llama3.2) |
| Keyword Search | MiniSearch (in-memory) |
| MCP Server | Local stdio transport |

Cloud features (API server, team sharing, cloud embeddings) are strictly opt-in and require explicit configuration.

### Rationale

- Code never leaves the machine without explicit user consent
- No cloud infrastructure required for basic operation
- Works in air-gapped environments
- Reduces latency (no network round-trips for embedding)
- Zero ongoing cost for local-only usage

### Trade-offs

| Pro | Con |
|-----|-----|
| Privacy and security by default | Local LLMs require GPU or fast CPU |
| No cloud costs | Local embedding quality may be lower than cloud models |
| Works offline and air-gapped | Ollama must be installed and running |
| Low latency for embedding | Team features require opting into cloud mode |

> **Warning: Ollama must be installed and running for NL enrichment and local embeddings. Without it, enrichment is skipped (chunks get empty `nlSummary`) and a cloud embedding provider must be configured.**

---

## 8. Result<T, E> Over Exceptions {#result-pattern}

**Status**: Accepted

### Context

JavaScript/TypeScript exceptions are invisible in type signatures. A function that may throw provides no compile-time indication of failure modes. This leads to unhandled errors, especially in complex pipelines with many failure points.

### Decision

Use the `Result<T, E>` pattern from the [neverthrow](https://github.com/supermacro/neverthrow) library for all fallible operations. Custom error types (e.g., `ParseError`, `ChunkError`, `EmbedError`, `IndexerError`) extend `Error` for debugging while remaining typed.

### Usage Pattern

```typescript
import { ok, err, type Result } from 'neverthrow';

// Every fallible function returns Result
async function parse(path: string): Promise<Result<ParsedFile, ParseError>> {
  try {
    // ... parsing logic ...
    return ok(parsedFile);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err(new ParseError(`Failed to parse ${path}: ${message}`));
  }
}

// Callers handle both paths explicitly
const result = await parser.parse(filePath, content);
if (result.isErr()) {
  // Handle error -- compiler enforces this check
  logger.warn(result.error.message);
  return;
}
// result.value is typed as ParsedFile
const parsed = result.value;
```

### Rationale

- All error paths are visible in type signatures
- Compiler enforces error handling (cannot access `.value` without checking)
- Error types carry domain-specific information
- Pipeline stages can propagate errors cleanly with `.map()` and `.andThen()`
- No risk of unhandled promise rejections

### Trade-offs

| Pro | Con |
|-----|-----|
| Type-safe error handling | More verbose than try/catch |
| Compiler-enforced error checks | Learning curve for neverthrow API |
| Explicit error propagation | Must wrap third-party exceptions at boundaries |
| Domain-specific error types | Slight overhead from Result object creation |

> **Tip: The convention across CodeRAG is: internal boundaries between try/catch and the Result type happen at the outermost layer of each class method. Third-party exceptions are caught and wrapped into domain-specific error types immediately.**

---

## Decision Summary

| # | Decision | Key Benefit | See Also |
|:-:|----------|-------------|----------|
| 1 | [NL Enrichment](#nl-enrichment\) | 10x retrieval quality | [Ingestion Pipeline](ingestion-pipeline.md) |
| 2 | [AST Chunking](#ast-chunking\) | Semantic chunk boundaries | [Ingestion Pipeline](ingestion-pipeline.md) |
| 3 | [Hybrid Search](#hybrid-search\) | Semantic + keyword coverage | [Hybrid Search](hybrid-search.md) |
| 4 | [Graph Expansion](#graph-expansion\) | Rich context with tests, interfaces | [Dependency Graph](dependency-graph.md) |
| 5 | [Token Budget](#token-budget\) | Fits agent context windows | [Retrieval Pipeline](retrieval-pipeline.md) |
| 6 | [Provider Pattern](#provider-pattern\) | Swappable external dependencies | [Overview](overview.md) |
| 7 | [Local-First](#local-first\) | Privacy, offline operation | [Overview](overview.md) |
| 8 | [Result Pattern](#result-pattern\) | Type-safe error handling | -- |
