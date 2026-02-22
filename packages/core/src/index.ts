export type {
  Chunk,
  ChunkMetadata,
  ChunkType,
  ChunkWithEmbedding,
  CodeRAGConfig,
  EmbeddingConfig,
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

export type { SupportedLanguage } from './parser/index.js';
export { TreeSitterParser, LanguageRegistry } from './parser/index.js';

export type { ASTChunkerConfig } from './chunker/index.js';
export { ASTChunker } from './chunker/index.js';

export type { GraphNode, GraphEdge, ImportInfo } from './graph/index.js';
export { DependencyGraph, extractImports, GraphBuilder, GraphError } from './graph/index.js';

export type { OllamaConfig } from './enrichment/index.js';
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
} from './indexer/index.js';

export type { OllamaEmbeddingConfig, QdrantConfig } from './embedding/index.js';
export {
  OllamaEmbeddingProvider,
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
