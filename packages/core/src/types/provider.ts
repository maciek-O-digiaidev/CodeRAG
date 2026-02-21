import type { Result } from 'neverthrow';
import type { Chunk } from './chunk.js';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export class ChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkError';
  }
}

export class EmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedError';
  }
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface ParsedFile {
  filePath: string;
  language: string;
  content: string;
  declarations: string[];
}

export interface Parser {
  parse(filePath: string, content: string): Promise<Result<ParsedFile, ParseError>>;
  supportedLanguages(): string[];
}

export interface Chunker {
  chunk(parsed: ParsedFile): Promise<Result<Chunk[], ChunkError>>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Result<number[][], EmbedError>>;
  readonly dimensions: number;
}

export interface VectorStore {
  upsert(
    ids: string[],
    embeddings: number[][],
    metadata: Record<string, unknown>[],
  ): Promise<Result<void, StoreError>>;
  query(
    embedding: number[],
    topK: number,
  ): Promise<Result<{ id: string; score: number }[], StoreError>>;
  delete(ids: string[]): Promise<Result<void, StoreError>>;
  count(): Promise<Result<number, StoreError>>;
  close(): void;
}

export interface LLMProvider {
  generate(prompt: string): Promise<Result<string, LLMError>>;
}
