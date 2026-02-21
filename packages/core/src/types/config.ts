export interface EmbeddingConfig {
  provider: string;
  model: string;
  dimensions: number;
}

export interface LLMConfig {
  provider: string;
  model: string;
}

export interface IngestionConfig {
  maxTokensPerChunk: number;
  exclude: string[];
}

export interface SearchConfig {
  topK: number;
  vectorWeight: number;
  bm25Weight: number;
}

export interface StorageConfig {
  path: string;
}

export interface ProjectConfig {
  name: string;
  languages: string[] | 'auto';
}

export interface ReRankerConfig {
  enabled: boolean;
  model: string;
  topN: number;
}

export interface CodeRAGConfig {
  version: string;
  project: ProjectConfig;
  ingestion: IngestionConfig;
  embedding: EmbeddingConfig;
  llm: LLMConfig;
  search: SearchConfig;
  storage: StorageConfig;
  reranker?: ReRankerConfig;
}
