---
tags:
  - reference
  - glossary
  - terminology
aliases:
  - glossary
  - terms
  - definitions
---

# Glossary

Alphabetical reference of key terms used throughout CodeRAG documentation and source code.

---

### AST (Abstract Syntax Tree)

A tree representation of the syntactic structure of source code. CodeRAG uses [Tree-sitter](https://tree-sitter.github.io/) to parse code into ASTs, enabling semantically meaningful chunking rather than arbitrary line splits. See [[design-decisions]].

### BM25

A probabilistic ranking function used for keyword-based full-text search. CodeRAG implements BM25 via MiniSearch as the keyword component of [[hybrid-search]]. BM25 excels at exact term matching, complementing vector search for identifiers and error messages. See [[core]].

### Chunk / ChunkType

A discrete unit of code or documentation extracted during ingestion. Chunks are the atomic units that get embedded and stored in the vector database. Chunk types include `function`, `class`, `method`, `interface`, `module`, `import`, and `comment`. Chunks are created by the AST-based chunker. See [[design-decisions]].

### Cross-Encoder

A neural network architecture that scores the relevance of a query-document pair jointly (as opposed to bi-encoders that encode query and document independently). CodeRAG uses a `CrossEncoderReRanker` to re-score top search results for improved precision. See [[core]].

### Dependency Graph

A directed graph tracking relationships between code chunks: imports, exports, function calls, class inheritance, and test associations. CodeRAG uses the graph for context expansion -- after finding relevant chunks, it traverses the graph to include related code (tests, interfaces, callers). See [[dependency-graph]], [[multi-repo]].

### Embedding / Embedding Provider

A dense vector representation of text in high-dimensional space, where semantically similar content maps to nearby points. An `EmbeddingProvider` is the interface for generating these vectors. CodeRAG supports Ollama (local), Voyage Code, and OpenAI as providers. See [[embedding-providers]], [[interfaces]].

### Hybrid Search

A search strategy that combines vector (semantic) search with BM25 (keyword) search using Reciprocal Rank Fusion (RRF). This approach leverages the strengths of both methods: semantic understanding from vectors and exact matching from keywords. See [[design-decisions]], [[core]].

### Incremental Indexing

The ability to update the index by processing only files that have changed since the last indexing run. CodeRAG tracks file content hashes in an `IndexState` and skips unchanged files, making re-indexing fast after small changes. See [[multi-repo]].

### LanceDB

An embedded, columnar vector database used as CodeRAG's default vector store. LanceDB requires zero infrastructure (no separate server process) and stores data as local files, aligning with CodeRAG's local-first design. See [[core]], [[design-decisions]].

### MCP (Model Context Protocol)

An open protocol for connecting AI models to external data sources and tools. CodeRAG exposes its functionality as MCP tools (`coderag_search`, `coderag_context`, `coderag_status`, `coderag_explain`, `coderag_docs`, `coderag_backlog`) that AI coding agents can call. See [[mcp-tools]].

### MiniSearch

A lightweight, zero-dependency full-text search library used to implement BM25 keyword search in CodeRAG. MiniSearch indexes chunk content and supports boolean queries, prefix matching, and fuzzy search. See [[core]].

### NL Enrichment

The process of translating code into natural language descriptions before creating embeddings. For example, a function signature gets a description like "Authenticates a user by validating their JWT token and returning the user profile." This technique, proven by Greptile to yield 10x improvement in retrieval quality, bridges the vocabulary gap between code and natural language queries. See [[design-decisions]].

### Ollama

A local inference server for running LLMs and embedding models on your own hardware. CodeRAG uses Ollama for both NL enrichment (via qwen2.5-coder or llama3.2) and local embeddings (via nomic-embed-text). See [[embedding-providers]].

### Provider Pattern

An architectural pattern where all external dependencies are accessed through interfaces. This enables easy testing with mocks, swapping implementations without changing consumers, and clear dependency boundaries. Key interfaces include `EmbeddingProvider`, `VectorStore`, `BacklogProvider`, `AuthProvider`, and `ReRanker`. See [[interfaces]], [[contributing]].

### Qdrant

An open-source vector database supported as an alternative to LanceDB. Qdrant runs as a separate server and is suitable for larger deployments or when you need features like distributed search. Configure it via the `storage.provider: qdrant` option. See [[configuration]].

### RAG (Retrieval-Augmented Generation)

A technique that enhances AI model responses by first retrieving relevant context from a knowledge base, then providing that context to the model alongside the user's query. CodeRAG builds and maintains the retrieval side of this pipeline specifically for codebases. See [[overview]].

### Reciprocal Rank Fusion (RRF)

A method for combining ranked lists from multiple search systems into a single unified ranking. CodeRAG uses RRF to merge results from vector search and BM25 keyword search, with configurable weights (`vectorWeight` and `bm25Weight`). See [[design-decisions]], [[core]].

### Result Pattern (neverthrow)

An error handling pattern using `Result<T, E>` types instead of throwing exceptions. A `Result` is either `ok(value)` or `err(error)`, forcing callers to handle both cases explicitly. CodeRAG uses the [neverthrow](https://github.com/supermacro/neverthrow) library for this pattern throughout the codebase. See [[contributing]].

### Token Budget

The maximum number of tokens available for context in an AI agent's prompt. CodeRAG's `TokenBudgetOptimizer` assembles retrieved chunks within this budget, prioritizing by relevance score and deduplicating overlapping content. See [[core]].

### Tree-sitter

A parser generator tool and incremental parsing library that produces concrete syntax trees for source code. CodeRAG uses Tree-sitter's WASM bindings to parse code into ASTs, enabling language-aware chunking that respects function, class, and module boundaries. See [[design-decisions]].

### UMAP

Uniform Manifold Approximation and Projection -- a dimensionality reduction technique used to visualize high-dimensional embeddings in 2D or 3D space. CodeRAG's Viewer includes a UMAP scatter plot showing how code chunks cluster by semantic similarity. Implemented in pure TypeScript with zero external dependencies. See [[overview]].

### Vector Store

An interface for persisting and querying vector embeddings. Supports operations: `upsert` (add/update vectors), `query` (find nearest neighbors), `delete` (remove vectors), and `count` (total vectors stored). Implementations include LanceDB (default, embedded) and Qdrant (external server). See [[interfaces]], [[configuration]].
