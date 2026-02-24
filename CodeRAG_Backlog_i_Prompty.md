# CodeRAG — Backlog produktu i prompty do autonomicznego developmentu

## Spis treści
1. [Podsumowanie backlogu](#1-podsumowanie-backlogu)
2. [Backlog — Epics i Stories](#2-backlog--epics-i-stories)
3. [CLAUDE.md — kontekst projektu dla agentów](#3-claudemd--kontekst-projektu-dla-agentów)
4. [Prompty do autonomicznego developmentu](#4-prompty-do-autonomicznego-developmentu)
5. [Kolejność uruchomienia promptów](#5-kolejność-uruchomienia-promptów)

---

## 1. Podsumowanie backlogu

| Metryka | Wartość |
|---------|---------|
| Epics | 12 |
| User Stories łącznie | 55 |
| Stories MVP | 31 |
| Stories Post-MVP | 24 |
| Szacowany czas MVP | 6-8 tygodni |
| Szacowany czas v1.0 | 6 miesięcy |

### Podział na fazy

| Faza | Epics | Stories | Cel |
|------|-------|---------|-----|
| Faza 0: PoC | EPIC 0 | 3 | Walidacja koncepcji |
| Faza 1: MVP | EPIC 1-5, 10 | 28 | Publiczny release |
| Faza 2: Multi-source | EPIC 6-7 | 8 | Product Hunt launch |
| Faza 3: IDE & Docs | EPIC 8-9 | 5 | VS Code Marketplace |
| Faza 4: Enterprise | EPIC 11 | 4 | Enterprise pilots |

---

## 2. Backlog — Epics i Stories

### EPIC 0: Project Setup & Infrastructure ⭐ MVP
**Faza 0 | 4 stories (3 MVP)**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 0.1 | Inicjalizacja repozytorium i struktury projektu | ✅ | P1 | S |
| 0.2 | Konfiguracja CI/CD pipeline | ✅ | P1 | S |
| 0.3 | Przygotowanie CLAUDE.md i .coderag.yaml | ✅ | P1 | S |
| 0.4 | Konfiguracja Docker dla development | ❌ | P3 | S |

### EPIC 1: Code Ingestion Pipeline ⭐ MVP
**Faza 1 | 7 stories (7 MVP)**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 1.1 | Integracja Tree-sitter z WASM bindings | ✅ | P1 | M |
| 1.2 | AST-based Code Chunking Engine | ✅ | P1 | L |
| 1.3 | NL Summary Generator dla chunków kodu | ✅ | P1 | L |
| 1.4 | Metadata Extraction & Dependency Graph | ✅ | P2 | M |
| 1.5 | Git Integration & File Watcher | ✅ | P2 | M |
| 1.6 | Incremental Re-indexing Engine | ✅ | P2 | M |
| 1.7 | Config file parser (.coderag.yaml) | ✅ | P1 | S |

### EPIC 2: Embedding & Vector Storage ⭐ MVP
**Faza 1 | 5 stories (4 MVP)**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 2.1 | Embedding Provider Abstraction Layer | ✅ | P1 | M |
| 2.2 | LanceDB Vector Store Integration | ✅ | P1 | M |
| 2.3 | BM25 Keyword Index | ✅ | P2 | S |
| 2.4 | Hybrid Search z Reciprocal Rank Fusion | ✅ | P1 | M |
| 2.5 | Qdrant Vector Store Provider | ❌ | P3 | M |

### EPIC 3: Retrieval & Context Assembly ⭐ MVP
**Faza 1 | 4 stories (3 MVP)**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 3.1 | Query Understanding Module | ✅ | P2 | M |
| 3.2 | Graph-based Context Expansion | ✅ | P2 | M |
| 3.3 | Token Budget Optimizer (Context Assembly) | ✅ | P2 | M |
| 3.4 | Cross-encoder Re-ranker | ❌ | P3 | L |

### EPIC 4: MCP Server (Agent Interface) ⭐ MVP
**Faza 1 | 8 stories (4 MVP)**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 4.1 | MCP Server Core z stdio transport | ✅ | P1 | M |
| 4.2 | MCP Tool: coderag_search | ✅ | P1 | M |
| 4.3 | MCP Tool: coderag_context | ✅ | P1 | M |
| 4.4 | MCP Tool: coderag_status | ✅ | P2 | S |
| 4.5 | MCP Tool: coderag_explain | ❌ | P3 | M |
| 4.6 | MCP Tool: coderag_backlog | ❌ | P3 | M |
| 4.7 | MCP Tool: coderag_docs | ❌ | P3 | M |
| 4.8 | SSE Transport dla MCP Server | ❌ | P3 | S |

### EPIC 5: CLI Tool ⭐ MVP
**Faza 1 | 6 stories (6 MVP)**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 5.1 | CLI: coderag init | ✅ | P1 | S |
| 5.2 | CLI: coderag index | ✅ | P1 | M |
| 5.3 | CLI: coderag search | ✅ | P2 | S |
| 5.4 | CLI: coderag serve | ✅ | P1 | S |
| 5.5 | CLI: coderag status | ✅ | P2 | S |
| 5.6 | NPM package publishing | ✅ | P2 | S |

### EPIC 6: Multi-repo Support
**Faza 2 | 3 stories**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 6.1 | Multi-repo configuration | ❌ | P2 | S |
| 6.2 | Cross-repo indexing pipeline | ❌ | P2 | M |
| 6.3 | Cross-repo dependency graph | ❌ | P3 | L |

### EPIC 7: Backlog Integration (Jira / ADO / ClickUp)
**Faza 2 | 5 stories**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 7.1 | Backlog Provider Abstraction | ❌ | P2 | S |
| 7.2 | Jira Integration | ❌ | P2 | M |
| 7.3 | Azure DevOps Integration | ❌ | P2 | M |
| 7.4 | ClickUp Integration | ❌ | P3 | M |
| 7.5 | Backlog-Code Linking | ❌ | P2 | M |

### EPIC 8: Documentation Integration
**Faza 3 | 3 stories (1 MVP)**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 8.1 | Markdown / Obsidian Parser | ✅ | P2 | S |
| 8.2 | Confluence Integration | ❌ | P3 | M |
| 8.3 | SharePoint Integration | ❌ | P3 | L |

### EPIC 9: VS Code Extension
**Faza 3 | 3 stories**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 9.1 | VS Code Extension: Basic Setup | ❌ | P3 | M |
| 9.2 | VS Code Extension: Search Panel | ❌ | P3 | L |
| 9.3 | VS Code Extension: Auto MCP Config | ❌ | P3 | S |

### EPIC 10: Benchmarks & Quality Assurance ⭐ MVP
**Faza 1 | 3 stories (3 MVP)**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 10.1 | Benchmark Dataset Creation | ✅ | P2 | M |
| 10.2 | Baseline Comparison (grep vs CodeRAG) | ✅ | P2 | S |
| 10.3 | Performance Benchmarks | ✅ | P2 | S |

### EPIC 11: Cloud Deployment & Team Features
**Faza 4 | 4 stories**

| # | Story | MVP | Priorytet | Effort |
|---|-------|-----|-----------|--------|
| 11.1 | Cloud API Server | ❌ | P3 | XL |
| 11.2 | Team Shared Context | ❌ | P3 | L |
| 11.3 | Admin Dashboard | ❌ | P4 | L |
| 11.4 | SSO / SAML / RBAC | ❌ | P4 | L |

---

## 3. CLAUDE.md — kontekst projektu dla agentów

Poniższy plik powinien być umieszczony w katalogu głównym repozytorium jako `CLAUDE.md`:

```markdown
# CodeRAG — Project Context for AI Agents

## What is CodeRAG?
CodeRAG is an intelligent codebase context engine for AI coding agents. It creates a semantic vector database (RAG) from source code, documentation, and project backlog, then exposes it as MCP tools that give AI agents deep understanding of the entire codebase.

## Architecture
```
Sources (Git, Jira, Confluence, MD)
  → Ingestion Pipeline (Tree-sitter AST, NL enrichment, metadata)
    → Embedding & Storage (LanceDB, BM25 index, dependency graph)
      → Retrieval Engine (hybrid search, graph expansion, re-ranking, token budget)
        → Agent Interface (MCP Server: coderag_search, coderag_context, coderag_status)
```

## Tech Stack
- **Language**: TypeScript (Node.js, ESM)
- **Code parsing**: Tree-sitter (WASM bindings)
- **Embedding (local)**: Ollama + nomic-embed-text
- **Embedding (API)**: voyage-code-3, OpenAI text-embedding-3-small
- **Vector DB**: LanceDB (embedded, zero-infra)
- **Keyword search**: MiniSearch (BM25)
- **NL Summarization**: Ollama (qwen2.5-coder / llama3.2)
- **MCP Server**: @modelcontextprotocol/sdk
- **CLI**: Commander.js
- **Testing**: Vitest with coverage
- **Package manager**: pnpm workspaces

## Project Structure
```
coderag/
├── packages/
│   ├── core/              # Core library: ingestion, embedding, retrieval
│   │   ├── src/
│   │   │   ├── ingestion/  # Tree-sitter parser, chunking, NL enrichment
│   │   │   ├── embedding/  # Provider abstraction, LanceDB, BM25
│   │   │   ├── retrieval/  # Hybrid search, graph expansion, context assembly
│   │   │   ├── config/     # .coderag.yaml parser
│   │   │   └── types/      # Shared TypeScript types
│   │   └── tests/
│   ├── cli/               # CLI tool (coderag init/index/search/serve/status)
│   │   ├── src/
│   │   └── tests/
│   ├── mcp-server/        # MCP server (stdio + SSE transport)
│   │   ├── src/
│   │   └── tests/
│   └── benchmarks/        # Benchmark suite
│       ├── datasets/
│       └── src/
├── .coderag.yaml          # Project config (dogfooding!)
├── CLAUDE.md              # This file
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Coding Conventions
- **TypeScript strict mode** — no `any`, no `as` casts without justification
- **ESM modules** — use `import/export`, no `require()`
- **Functional style** — prefer pure functions, minimize mutable state
- **Error handling** — use Result<T, E> pattern (neverthrow), no uncaught throws
- **Naming**: camelCase for functions/vars, PascalCase for types/classes, UPPER_SNAKE for constants
- **Files**: kebab-case (e.g., `tree-sitter-parser.ts`)
- **Tests**: co-located `*.test.ts` files, describe/it pattern, 80%+ coverage on core
- **Abstractions**: use interfaces for providers (EmbeddingProvider, VectorStore, BacklogProvider)
- **Config**: all configuration via .coderag.yaml, sensible defaults for everything

## Key Design Decisions
1. **NL enrichment before embedding** — translate code to natural language descriptions before creating embeddings (proven 10x improvement by Greptile)
2. **AST-based chunking** — use Tree-sitter AST to create semantically meaningful chunks, not arbitrary line splits
3. **Hybrid search** — combine vector (semantic) + BM25 (keyword) with Reciprocal Rank Fusion
4. **Graph expansion** — after finding relevant chunks, expand results using dependency graph (tests, interfaces, callers)
5. **Token budget optimization** — assemble context within agent's token budget, prioritize by relevance
6. **Provider pattern** — all external dependencies behind interfaces for easy swapping
7. **Local-first** — everything works offline with Ollama + LanceDB, no cloud required

## Important Context
- This project is built using AI coding agents (dogfooding)
- MCP (Model Context Protocol) is the primary delivery mechanism
- Privacy-first: code never leaves the machine without explicit opt-in
- Performance targets: 50k LOC indexing < 5 min, query < 500ms
```

---

## 4. Prompty do autonomicznego developmentu

Poniższe prompty są zaprojektowane do uruchomienia w Claude Code, Gemini CLI lub innym agencie kodującym. Każdy prompt jest self-contained i zawiera pełny kontekst potrzebny do wykonania zadania.

---

### PROMPT 0: Project Initialization
**Stories: 0.1, 0.2, 0.3 | Czas: ~1h | Zależności: brak**

```
Zainicjalizuj projekt CodeRAG od podstaw. Wykonaj poniższe kroki:

1. STRUKTURA PROJEKTU
Utwórz monorepo z pnpm workspaces:
- packages/core — biblioteka główna (ingestion, embedding, retrieval)
- packages/cli — narzędzie CLI
- packages/mcp-server — MCP server
- packages/benchmarks — suite benchmarkowy

2. KONFIGURACJA
- TypeScript 5.x z strict mode, ESM modules, path aliases
- pnpm workspace z wspólnym tsconfig.base.json
- ESLint flat config z @typescript-eslint, rules: no-any, no-explicit-any
- Prettier z domyślnymi ustawieniami
- Vitest z coverage (v8 provider), threshold 80% na packages/core

3. CI/CD
Utwórz .github/workflows/ci.yml:
- Trigger: push to main, PR
- Jobs: lint → test → build (parallel test + build po lint)
- Node.js 20.x, pnpm 9.x
- Cache pnpm store

4. PLIKI KONTEKSTOWE
- Utwórz CLAUDE.md w katalogu głównym (skopiuj treść z sekcji 3 tego dokumentu)
- Utwórz .coderag.yaml z domyślną konfiguracją projektu
- Utwórz README.md z: opisem projektu, quick start, architekturą, contributing

5. PACKAGE.JSON
packages/core:
  - name: @code-rag/core
  - dependencies: web-tree-sitter, vectordb (lancedb), minisearch, neverthrow, yaml
  - devDependencies: vitest, @types/node

packages/cli:
  - name: coderag
  - bin: { coderag: ./dist/index.js }
  - dependencies: commander, chalk, ora, @code-rag/core

packages/mcp-server:
  - name: @code-rag/mcp-server
  - dependencies: @modelcontextprotocol/sdk, @code-rag/core

6. TYPES
W packages/core/src/types/ utwórz:
- chunk.ts — interface Chunk { id, content, nlSummary, metadata, embedding? }
- config.ts — interface CodeRAGConfig parsowany z .coderag.yaml
- provider.ts — interface EmbeddingProvider, VectorStore, LLMProvider
- search.ts — interface SearchResult, SearchQuery, SearchOptions

Upewnij się że projekt builduje (pnpm build) i testy przechodzą (pnpm test).
```

---

### PROMPT 1: Tree-sitter Integration & AST Chunking
**Stories: 1.1, 1.2, 1.7 | Czas: ~3h | Zależności: PROMPT 0**

```
Zaimplementuj moduł parsowania kodu i AST-based chunking w packages/core/src/ingestion/.

1. TREE-SITTER INTEGRATION (src/ingestion/tree-sitter-parser.ts)
- Skonfiguruj web-tree-sitter z WASM bindings
- Obsługa języków: JavaScript, TypeScript, Python, Go, Rust, Java, C#, C, C++, Ruby, PHP
- Lazy loading gramatyk WASM (ładuj tylko potrzebne)
- Funkcja parseFile(filePath: string, content: string): ParsedAST
- Zwracaj: AST root node, language, parse errors

2. AST CHUNKING ENGINE (src/ingestion/chunker.ts)
- Funkcja chunkFile(parsedAST: ParsedAST, config: ChunkConfig): Chunk[]
- Typy chunków: function, method, class, module, interface, type_alias, config_block, import_block
- Dla każdego chunka:
  - Ekstrakcja: pełny kod, sygnatura, docstring/komentarze, lista importów
  - Metadata: start_line, end_line, chunk_type, name, parent_class/module
  - Respektuj max_tokens (default 512) — duże funkcje dziel na logiczne bloki
- Obsługa edge cases: nested classes, anonymous functions, decorators

3. CONFIG PARSER (src/config/config-parser.ts)
- Parsowanie .coderag.yaml z biblioteką yaml
- Walidacja schematu (ręczna lub z zod)
- Sensowne defaults: { maxTokens: 512, languages: 'auto', embedding: { provider: 'ollama', model: 'nomic-embed-text' } }
- Funkcja loadConfig(rootDir: string): Result<CodeRAGConfig, ConfigError>

4. TESTY
- Przygotuj test fixtures: pliki .ts, .py, .go, .rs, .java z różnymi strukturami
- Test: parsowanie każdego języka zwraca poprawne AST
- Test: chunking funkcji, klas, modułów, interfejsów
- Test: respektowanie max_tokens
- Test: config parser z valid/invalid YAML
- Coverage > 80%

Pamiętaj:
- Używaj ESM imports, TypeScript strict mode
- Error handling z neverthrow (Result<T, E>)
- Każdy publiczny interfejs ma JSDoc komentarze
```

---

### PROMPT 2: NL Enrichment & Metadata Extraction
**Stories: 1.3, 1.4 | Czas: ~3h | Zależności: PROMPT 1**

```
Zaimplementuj NL Summary Generator i Metadata/Dependency extraction w packages/core/src/ingestion/.

1. LLM PROVIDER ABSTRACTION (src/ingestion/llm-provider.ts)
- Interface LLMProvider { generate(prompt: string, options?: LLMOptions): Promise<Result<string, LLMError>> }
- OllamaProvider: HTTP API do lokalnego Ollama (default model: qwen2.5-coder:7b)
- AnthropicProvider: Claude API (claude-3-haiku dla enrichment — szybki i tani)
- OpenAIProvider: GPT-4o-mini API
- Konfiguracja w .coderag.yaml: { llm: { provider: 'ollama', model: 'qwen2.5-coder:7b' } }

2. NL SUMMARY GENERATOR (src/ingestion/nl-enricher.ts)
- Funkcja enrichChunks(chunks: Chunk[], llmProvider: LLMProvider): Promise<Chunk[]>
- Prompt template dla każdego chunka:
  """
  Describe what this code does in 1-3 sentences in English.
  Focus on: purpose, inputs, outputs, side effects.
  Be specific — mention function/class names, data types, algorithms.

  File: {filePath}
  Language: {language}

  ```{language}
  {code}
  ```
  """
- Batch processing: max 10 concurrent requests
- Rate limiting: respektuj provider limits
- Fallback: jeśli LLM niedostępny, generuj prosty summary z sygnatury (np. "Function calculateTotal in module billing")
- Cache: nie re-generuj summary dla niezmienionych chunków (hash content → cache)

3. METADATA & DEPENDENCY EXTRACTION (src/ingestion/metadata-extractor.ts)
- Funkcja extractMetadata(chunk: Chunk, parsedAST: ParsedAST): ChunkMetadata
- Metadata:
  - filePath, language, repo, branch (z git)
  - lastModified, author (z git log)
  - chunkType, name, parentName
  - imports: lista importowanych modułów/funkcji
  - exports: co chunk eksportuje
  - calls: lista wywoływanych funkcji (static analysis z AST)

4. DEPENDENCY GRAPH (src/ingestion/dependency-graph.ts)
- Lekki graf w pamięci: Map<chunkId, { imports: chunkId[], calledBy: chunkId[], implements: chunkId[] }>
- Budowa grafu po indeksacji wszystkich chunków
- Persystencja: serializacja do JSON w .coderag/graph.json
- Funkcje: getRelated(chunkId, depth), getDependencies(chunkId), getDependents(chunkId)

5. TESTY
- Mock LLM provider dla testów (zwraca predefined summaries)
- Test: enrichment generuje sensowne summaries
- Test: metadata extraction z fixtures
- Test: dependency graph building i querying
- Test: fallback gdy LLM niedostępny
- Test: cache działa (nie re-generuje dla tych samych chunków)
```

---

### PROMPT 3: Embedding & Vector Storage
**Stories: 2.1, 2.2, 2.3, 2.4 | Czas: ~3h | Zależności: PROMPT 2**

```
Zaimplementuj warstwę embedding i vector storage w packages/core/src/embedding/.

1. EMBEDDING PROVIDER (src/embedding/embedding-provider.ts)
- Interface EmbeddingProvider {
    embed(text: string): Promise<Result<number[], EmbedError>>
    embedBatch(texts: string[], batchSize?: number): Promise<Result<number[][], EmbedError>>
    dimensions(): number
  }
- OllamaEmbeddingProvider: HTTP API, model nomic-embed-text (768 dims) lub mxbai-embed-large (1024 dims)
- VoyageEmbeddingProvider: voyage-code-3 API (1024 dims) — najlepszy dla kodu
- OpenAIEmbeddingProvider: text-embedding-3-small (1536 dims)
- WAŻNE: embeduj NL summary (nie surowy kod!) — to kluczowe dla jakości retrieval

2. LANCEDB VECTOR STORE (src/embedding/lancedb-store.ts)
- Interface VectorStore {
    insert(chunks: ChunkWithEmbedding[]): Promise<Result<void, StoreError>>
    search(vector: number[], topK: number, filters?: MetadataFilter): Promise<Result<SearchResult[], StoreError>>
    delete(ids: string[]): Promise<Result<void, StoreError>>
    count(): Promise<number>
  }
- LanceDB schema: { id: string, vector: Float32Array, content: string, nl_summary: string,
    chunk_type: string, file_path: string, language: string, repo: string, metadata: string (JSON) }
- Persystencja w .coderag/lancedb/
- Metadata filtering: language, repo, file_path prefix, chunk_type

3. BM25 INDEX (src/embedding/bm25-index.ts)
- MiniSearch z polami: content, nl_summary, file_path, name
- Boost weights: nl_summary (2.0), name (1.5), content (1.0), file_path (0.5)
- Persystencja: serializacja do .coderag/bm25.json
- Rebuild po każdej reindeksacji

4. HYBRID SEARCH (src/embedding/hybrid-search.ts)
- Funkcja hybridSearch(query: string, options: SearchOptions): Promise<SearchResult[]>
- Pipeline:
  a) Embed query → vector search (LanceDB) → top 20
  b) BM25 search → top 20
  c) Reciprocal Rank Fusion: score = Σ 1/(k + rank), k=60
  d) Merge, deduplicate, sort by fused score
  e) Return top_k (default 10)
- Konfigurowalny weight vector vs BM25 (default 0.7 / 0.3)

5. ORCHESTRATOR (src/embedding/indexing-orchestrator.ts)
- Funkcja indexRepository(config: CodeRAGConfig): Promise<IndexingResult>
- Pipeline: discover files → parse → chunk → enrich → embed → store
- Progress callback: (stage, current, total) => void
- Incremental: compare file hashes, only process changed files
- Parallel processing: chunk enrichment i embedding w batch

6. TESTY
- Mock embedding provider (zwraca random vectors)
- Test: insert → search zwraca relevantne wyniki
- Test: hybrid search lepszy niż sam vector lub sam BM25
- Test: metadata filtering działa
- Test: incremental indexing nie re-procesuje unchanged files
```

---

### PROMPT 4: MCP Server
**Stories: 4.1, 4.2, 4.3, 4.4 | Czas: ~2h | Zależności: PROMPT 3**

```
Zaimplementuj MCP Server w packages/mcp-server/.

1. MCP SERVER CORE (src/server.ts)
- Użyj @modelcontextprotocol/sdk (Server class)
- Transport: stdio (default) — kompatybilny z Claude Code
- Inicjalizacja: załaduj .coderag.yaml, otwórz LanceDB, załaduj BM25 index, załaduj dependency graph
- Error handling: graceful degradation gdy DB pusta (zwróć helpful message)
- Logging: do stderr (nie stdout — to transport!)

2. TOOL: coderag_search
- Name: "coderag_search"
- Description: "Semantic search across codebase, docs and backlog. Returns relevant code chunks with context."
- Input schema: {
    query: string (required) — "what to search for",
    language: string (optional) — "filter by programming language",
    file_path: string (optional) — "filter by file path prefix",
    chunk_type: string (optional) — "filter: function|class|module|interface|config",
    top_k: number (optional, default 10) — "number of results"
  }
- Output: JSON array of { file_path, chunk_type, name, content (truncated to 500 chars), nl_summary, relevance_score }
- Wykorzystaj hybridSearch z packages/core

3. TOOL: coderag_context
- Name: "coderag_context"
- Description: "Get full context for a file or module, including related interfaces, tests, and dependencies."
- Input schema: {
    file_path: string (required) — "path to the file or module",
    include_tests: boolean (optional, default true),
    include_interfaces: boolean (optional, default true),
    include_callers: boolean (optional, default false),
    max_tokens: number (optional, default 8000)
  }
- Output: JSON with { target_chunks, related_chunks (tests, interfaces, deps), dependency_graph_excerpt }
- Wykorzystaj dependency graph z packages/core

4. TOOL: coderag_status
- Name: "coderag_status"
- Description: "Get indexing status, database statistics, and system health."
- Input schema: {} (no params)
- Output: JSON { total_chunks, indexed_repos, last_indexed_at, embedding_model, db_size_mb, languages, health: { embedding_provider, llm_provider, vector_db } }

5. KONFIGURACJA DLA CLAUDE CODE
Wygeneruj przykładowy config do dodania w .claude/settings.json:
{
  "mcpServers": {
    "coderag": {
      "command": "npx",
      "args": ["coderag", "serve"],
      "env": {}
    }
  }
}

6. TESTY
- Test: server startuje i odpowiada na initialize
- Test: coderag_search zwraca wyniki z mock DB
- Test: coderag_context zwraca kontekst z dependency graph
- Test: coderag_status zwraca poprawne statystyki
- Integration test: pełny flow init → index → search (z małym test repo)
```

---

### PROMPT 5: CLI Tool
**Stories: 5.1-5.6 | Czas: ~2h | Zależności: PROMPT 3, PROMPT 4**

```
Zaimplementuj CLI tool w packages/cli/.

1. CLI FRAMEWORK (src/index.ts)
- Commander.js z subcommands: init, index, search, serve, status
- Global options: --config <path>, --verbose, --quiet
- Wersja z package.json
- Help z przykładami użycia

2. COMMAND: coderag init (src/commands/init.ts)
- Interactive wizard (inquirer lub prompts):
  - Wykryj język projektu (package.json → JS/TS, pyproject.toml → Python, go.mod → Go, etc.)
  - Zapytaj o embedding provider: ollama (default) / voyage / openai
  - Zapytaj o LLM provider: ollama (default) / anthropic / openai
  - Generuj .coderag.yaml z wykrytymi ustawieniami
- Non-interactive: coderag init --yes (użyj defaults)
- Nie nadpisuj istniejącej konfiguracji (--force aby nadpisać)

3. COMMAND: coderag index (src/commands/index.ts)
- Uruchom indexingOrchestrator z packages/core
- Progress bar z ora: "Parsing files... [123/456]", "Enriching chunks...", "Embedding...", "Storing..."
- Podsumowanie: "✓ Indexed 456 files → 1234 chunks in 2m 34s"
- Flags: --force (full reindex), --dry-run (pokaż co się zmieni)

4. COMMAND: coderag search (src/commands/search.ts)
- Argumenty: coderag search "query" [--top-k N] [--language lang] [--type type]
- Output: kolorowy (chalk) z:
  - #1 [0.95] src/auth/middleware.ts (function)
    Auth middleware that validates JWT tokens and extracts user info
  - Kod: pierwsze 5 linii z podświetleniem

5. COMMAND: coderag serve (src/commands/serve.ts)
- Uruchom MCP server z packages/mcp-server
- Default: stdio transport
- --port <number>: SSE transport na podanym porcie
- Log: "CodeRAG MCP server started (stdio)" lub "CodeRAG MCP server listening on http://localhost:3333"

6. COMMAND: coderag status (src/commands/status.ts)
- Wyświetl status z kolorami:
  ┌─ CodeRAG Status ─────────────────┐
  │ Repos:     1 (my-project)        │
  │ Chunks:    1,234                  │
  │ Last index: 2 minutes ago        │
  │ DB size:   45 MB                 │
  │ Embedding: ollama/nomic-embed    │ ✓
  │ LLM:       ollama/qwen2.5-coder │ ✓
  └──────────────────────────────────┘

7. NPM PUBLISHING
- package.json: bin entry, files whitelist, engines (node >= 20)
- Upewnij się że npx coderag --help działa

8. TESTY
- Test każdego commandu z mock core functions
- Snapshot testy dla CLI output
```

---

### PROMPT 6: Benchmark Suite
**Stories: 10.1, 10.2, 10.3 | Czas: ~2h | Zależności: PROMPT 3**

```
Zbuduj benchmark suite w packages/benchmarks/.

1. DATASET (datasets/)
- Sklonuj 3 open-source projekty (małe-średnie):
  a) express (Node.js, ~15k LOC) — web framework
  b) fastapi (Python, ~12k LOC) — web framework
  c) chi (Go, ~5k LOC) — HTTP router
- Dla każdego projektu przygotuj 30-40 pytań testowych (JSON):
  {
    "query": "How does middleware chain work in Express?",
    "expected_files": ["lib/router/index.js", "lib/router/layer.js"],
    "expected_chunks": ["Router.prototype.use", "Layer.prototype.handle_request"],
    "category": "implementation"
  }

2. BENCHMARK RUNNER (src/benchmark-runner.ts)
- Zaindeksuj każdy projekt z CodeRAG
- Dla każdego pytania: uruchom coderag_search, porównaj wyniki z expected
- Metryki:
  - Relevance@5: % pytań gdzie expected chunk jest w top 5
  - Relevance@10: % pytań gdzie expected chunk jest w top 10
  - MRR (Mean Reciprocal Rank)
  - Średni czas query (ms)

3. BASELINE COMPARISON (src/baseline.ts)
- Baseline 1: grep/ripgrep keyword search
- Baseline 2: raw embedding (bez NL enrichment)
- Baseline 3: CodeRAG full pipeline (z NL enrichment + hybrid search)
- Generuj tabelę porównawczą

4. PERFORMANCE BENCHMARKS (src/perf-benchmark.ts)
- Metryki per rozmiar repo: indexing time, query latency (p50, p95, p99), memory usage, DB size
- Rozmiary: 1k, 10k, 50k LOC (użyj syntetycznych danych jeśli potrzeba)

5. RAPORT
- Generuj Markdown raport z wynikami
- Tabele, porównania, wnioski
- Cel MVP: Relevance@5 > 70%, query < 500ms, indexing 50k LOC < 5 min
```

---

### PROMPT 7: Integration Testing & Polish
**Stories: cross-cutting | Czas: ~2h | Zależności: PROMPT 0-6**

```
Przeprowadź integration testing i finalne poprawki przed release MVP.

1. END-TO-END TEST
Utwórz packages/core/tests/e2e/ z pełnym flow:
a) Utwórz tymczasowy test repo z plikami TypeScript i Python
b) coderag init (programmatycznie)
c) coderag index
d) Zweryfikuj: chunks w LanceDB, BM25 index, dependency graph
e) coderag_search — sprawdź że zwraca relevantne wyniki
f) coderag_context — sprawdź że zwraca powiązane chunki
g) Zmień plik → incremental reindex → zweryfikuj update
h) Cleanup

2. DOCUMENTATION
- README.md: pełny quick start z przykładami
- docs/configuration.md: wszystkie opcje .coderag.yaml
- docs/mcp-setup.md: jak skonfigurować z Claude Code, Gemini CLI, Continue.dev
- CONTRIBUTING.md: jak kontrybuować, code style, PR process

3. POLISH
- Upewnij się że wszystkie error messages są helpful
- Sprawdź graceful degradation: brak Ollama → informacyjny error z instrukcją instalacji
- Sprawdź że .coderagignore działa (node_modules, .git, dist, build)
- Upewnij się że pnpm build produkuje czyste dist/
- Sprawdź że npx coderag --help, init, index, search, serve, status — wszystko działa

4. RELEASE CHECKLIST
- [ ] All tests pass (pnpm test)
- [ ] Build succeeds (pnpm build)
- [ ] Lint clean (pnpm lint)
- [ ] README complete
- [ ] CHANGELOG.md z v0.1.0
- [ ] npm publish dry run
- [ ] Tested with Claude Code on real project
- [ ] Tested with Gemini CLI on real project
```

---

## 5. Kolejność uruchomienia promptów

```
PROMPT 0: Project Init          ──→ (1h)
    │
    ▼
PROMPT 1: Tree-sitter & Chunking ──→ (3h)
    │
    ▼
PROMPT 2: NL Enrichment & Metadata ──→ (3h)
    │
    ▼
PROMPT 3: Embedding & Vector Store ──→ (3h)
    │
    ├──────────────────────┐
    ▼                      ▼
PROMPT 4: MCP Server (2h)  PROMPT 6: Benchmarks (2h)
    │                      │
    ▼                      │
PROMPT 5: CLI Tool (2h)    │
    │                      │
    ├──────────────────────┘
    ▼
PROMPT 7: Integration & Polish ──→ (2h)
    │
    ▼
MVP READY (~18h pracy agentów)
```

### Uwagi do uruchamiania:
- Prompty 4 i 6 mogą być uruchamiane równolegle (niezależne od siebie)
- Każdy prompt jest self-contained — agent nie potrzebuje dodatkowego kontekstu poza CLAUDE.md
- Po każdym prompcie: uruchom `pnpm test` i `pnpm build` aby zweryfikować
- Jeśli agent napotka problem, daj mu kontekst z CLAUDE.md i output poprzedniego kroku
- Szacowane 18h pracy agentów = ~2-3 dni kalendarzowe dla 1 developera nadzorującego agentów
