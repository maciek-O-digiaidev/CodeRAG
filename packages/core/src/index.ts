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
  ProjectConfig,
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

export { loadConfig, ConfigError } from './config/config-parser.js';

export type {
  FileChange,
  FileChangeStatus,
  FileMetadata,
  GitClient,
  IgnoreFilter,
} from './git/index.js';
export { GitError, SimpleGitClient, createIgnoreFilter } from './git/index.js';
