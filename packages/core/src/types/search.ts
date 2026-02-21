import type { Chunk, ChunkMetadata } from './chunk.js';

export interface SearchQuery {
  text: string;
  filters?: SearchFilters;
  options?: SearchOptions;
}

export interface SearchFilters {
  languages?: string[];
  filePaths?: string[];
  chunkTypes?: string[];
}

export interface SearchOptions {
  topK?: number;
  vectorWeight?: number;
  bm25Weight?: number;
  expandGraph?: boolean;
}

export type SearchMethod = 'vector' | 'bm25' | 'hybrid';

export interface SearchResult {
  chunkId: string;
  chunk?: Chunk;
  content: string;
  nlSummary: string;
  score: number;
  method: SearchMethod;
  metadata: ChunkMetadata;
}
