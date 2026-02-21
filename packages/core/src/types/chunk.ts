export interface ChunkMetadata {
  chunkType: ChunkType;
  name: string;
  parentName?: string;
  declarations: string[];
  imports: string[];
  exports: string[];
}

export type ChunkType =
  | 'function'
  | 'method'
  | 'class'
  | 'module'
  | 'interface'
  | 'type_alias'
  | 'config_block'
  | 'import_block';

export interface Chunk {
  id: string;
  content: string;
  nlSummary: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  metadata: ChunkMetadata;
  embedding?: number[];
}

export interface ChunkWithEmbedding extends Chunk {
  embedding: number[];
}
