export type {
  Chunk,
  ChunkMetadata,
  ChunkType,
  ChunkWithEmbedding,
  CodeRAGConfig,
  EmbeddingConfig,
  OpenAICompatibleConfig,
  EmbeddingDockerConfig,
  LLMConfig,
  IngestionConfig,
  SearchConfig,
  StorageConfig,
  QdrantStorageConfig,
  ProjectConfig,
  RepoConfig,
  EmbeddingProvider,
  VectorStore,
  LLMProvider,
  Parser,
  Chunker,
  ParsedFile,
  SearchQuery,
  SearchFilters,
  SearchOptions,
  SearchResult,
  SearchMethod,
} from './types/index.js';

export {
  EmbedError,
  StoreError,
  LLMError,
  ParseError,
  ChunkError,
} from './types/index.js';

export { loadConfig, ConfigError, repoConfigSchema } from './config/config-parser.js';
export type { RepoConfigSchema } from './config/config-parser.js';

export type {
  FileChange,
  FileChangeStatus,
  FileMetadata,
  GitClient,
  IgnoreFilter,
} from './git/index.js';
export { GitError, SimpleGitClient, createIgnoreFilter } from './git/index.js';

export type { SupportedLanguage, MarkdownFrontmatter, ParsedMarkdown, MarkdownParserConfig } from './parser/index.js';
export {
  TreeSitterParser,
  LanguageRegistry,
  MarkdownParser,
  parseFrontmatter,
  extractWikilinks,
  extractTags,
} from './parser/index.js';

export type { ASTChunkerConfig } from './chunker/index.js';
export { ASTChunker } from './chunker/index.js';

export type { GraphNode, GraphEdge, ImportInfo, CrossRepoDependency, PackageManifest, DependencyType } from './graph/index.js';
export { DependencyGraph, extractImports, GraphBuilder, GraphError, CrossRepoResolver, CrossRepoError, parsePackageJson, parseGoMod, parseCargoToml } from './graph/index.js';

export type { OllamaConfig, EnrichBatchResult } from './enrichment/index.js';
export { OllamaClient, OllamaError, NLEnricher, EnrichmentError } from './enrichment/index.js';

export type {
  IndexedFileState,
  ScannedFile,
  IndexerConfig,
  ChangeSet,
  IndexerResult,
  RepoIndexResult,
  MultiRepoIndexResult,
  MultiRepoProgressCallback,
  MultiRepoIndexOptions,
  RepoProcessor,
  IndexCheckResult,
  FileWatcherConfig,
  FileWatcherEvents,
} from './indexer/index.js';
export {
  IndexState,
  computeFileHash,
  FileScanner,
  ScanError,
  IncrementalIndexer,
  IndexerError,
  MultiRepoIndexer,
  MultiRepoIndexerError,
  checkIndexExists,
  FileWatcher,
} from './indexer/index.js';

export type {
  OllamaEmbeddingConfig,
  OpenAICompatibleEmbeddingConfig,
  QdrantConfig,
  ModelLifecycleConfig,
  BackendInfo,
  BackendType,
  GpuMode,
  DockerConfig,
  ProgressCallback,
  ProcessExecutor,
  FetchFn,
} from './embedding/index.js';
export {
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  ModelLifecycleManager,
  ModelLifecycleError,
  LanceDBStore,
  QdrantVectorStore,
  BM25Index,
  HybridSearch,
} from './embedding/index.js';

export type {
  AnalyzedQuery,
  QueryIntent,
  QueryEntity,
  ReadonlyGraph,
  RelationshipType,
  RelatedChunk,
  GraphExcerpt,
  ExpandedContext,
  ChunkLookupFn,
  TokenBudgetConfig,
  AssembledContext,
  CrossEncoderConfig,
} from './retrieval/index.js';
export {
  QueryAnalyzer,
  ContextExpander,
  TokenBudgetOptimizer,
  CrossEncoderReRanker,
  ReRankerError,
} from './retrieval/index.js';

export type { ReRankerConfig, ReRanker, BacklogConfig } from './types/index.js';

export type {
  BacklogItemType,
  BacklogItem,
  BacklogQuery,
  BacklogProvider,
  AzureDevOpsConfig,
  ClickUpConfig,
  JiraConfig,
  BacklogCodeMap,
  CoverageReport,
} from './backlog/index.js';
export {
  BacklogError,
  AzureDevOpsProvider,
  ClickUpProvider,
  scanForABReferences,
  scanForClickUpReferences,
  JiraProvider,
  scanForJiraReferences,
  CodeLinker,
} from './backlog/index.js';

export type {
  ConfluenceConfig,
  ConfluencePage,
  ConfluenceContentType,
  ConfluenceChangedItem,
  DocsProvider,
} from './docs/index.js';
export {
  ConfluenceError,
  ConfluenceProvider,
  confluenceStorageToPlainText,
} from './docs/index.js';

export type {
  SharePointConfig,
  SharePointPage,
  SharePointDocument,
  SharePointItemType,
  SharePointChangedItem,
} from './docs/index.js';
export {
  SharePointError,
  SharePointProvider,
  extractTextFromDocx,
  extractTextFromPdf,
} from './docs/index.js';

export type {
  Role,
  Action,
  RepoAccessLevel,
  RepoPermission,
  User,
  AuthToken,
  AuditEntry,
  AuditQuery,
  AuthProvider,
  OIDCConfig,
  OIDCDiscoveryDocument,
  SAMLConfig,
  SAMLIdPMetadata,
} from './auth/index.js';
export { ROLE_HIERARCHY, AuthError, RBACManager, OIDCProvider, SAMLProvider, AuditLogger } from './auth/index.js';

export type {
  CloudStorageProvider,
  CloudStorageConfig,
  S3Config,
  AzureBlobConfig,
  GCSConfig,
  GCSCredentials,
} from './storage/index.js';
export {
  StorageError,
  S3StorageProvider,
  AzureBlobStorageProvider,
  GCSStorageProvider,
} from './storage/index.js';

export {
  safeString,
  safeNumber,
  safeRecord,
  safeArray,
  safeStringUnion,
} from './utils/safe-cast.js';

export type { CodeRAGRuntime, RuntimeOptions } from './runtime.js';
export { createRuntime, RuntimeError } from './runtime.js';

// --- Auto-generated Benchmarks ---

export type {
  ScannedEntity,
  IndexScanResult,
  BenchmarkQueryType,
  GeneratedQuery,
  QueryGeneratorOptions,
  QueryEvalResult,
  QueryMetrics,
  AggregateEvalMetrics,
  QueryTypeBreakdown,
  BenchmarkReport,
  BenchmarkMetadata,
  SearchFn,
  BenchmarkProgressFn,
} from './benchmarks/index.js';
export {
  IndexScanError,
  parseIndexRows,
  buildCallerMap,
  buildTestMap,
  generateQueries,
  generateFindByNameQueries,
  generateFindByDescriptionQueries,
  generateFindCallersQueries,
  generateFindTestsQueries,
  generateFindImportsQueries,
  BenchmarkEvalError,
  computeQueryMetrics,
  computeAggregateMetrics as computeBenchmarkAggregateMetrics,
  computeQueryTypeBreakdown,
  runBenchmark,
  formatBenchmarkSummary,
} from './benchmarks/index.js';

// --- API Contracts (shared Zod schemas for viewer REST API) ---

export {
  PaginationMetaSchema,
  ChunkSummarySchema,
  ChunkDetailSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  ViewerSearchResultSchema,
  EmbeddingPointSchema,
  ViewerStatsResponseSchema,
  ViewerChunksResponseSchema,
  ViewerChunkDetailResponseSchema,
  ViewerSearchResponseSchema,
  ViewerGraphResponseSchema,
  ViewerEmbeddingsResponseSchema,
} from './api-contracts/index.js';

export type {
  ViewerPaginationMeta,
  ViewerChunkSummary,
  ViewerChunkDetail,
  ViewerGraphNode,
  ViewerGraphEdge,
  ViewerSearchResultType,
  ViewerEmbeddingPoint,
  ViewerStatsResponse,
  ViewerChunksResponse,
  ViewerChunkDetailResponse,
  ViewerSearchResponse,
  ViewerGraphResponse,
  ViewerEmbeddingsResponse,
} from './api-contracts/index.js';
