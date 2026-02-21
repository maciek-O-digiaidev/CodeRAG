import MiniSearch from 'minisearch';
import type { Chunk, ChunkMetadata } from '../types/chunk.js';
import type { SearchResult } from '../types/search.js';

interface IndexedDocument {
  id: string;
  content: string;
  nlSummary: string;
  filePath: string;
  name: string;
  chunkType: string;
  language: string;
}

const MINISEARCH_FIELDS = ['content', 'nlSummary', 'filePath', 'name'];
const MINISEARCH_STORE_FIELDS = ['content', 'nlSummary', 'filePath', 'name', 'chunkType', 'language'];
const MINISEARCH_SEARCH_OPTIONS = {
  boost: {
    nlSummary: 2.0,
    name: 1.5,
    content: 1.0,
    filePath: 0.5,
  },
  prefix: true,
  fuzzy: 0.2,
};

export class BM25Index {
  private miniSearch: MiniSearch<IndexedDocument>;

  constructor() {
    this.miniSearch = new MiniSearch<IndexedDocument>({
      fields: MINISEARCH_FIELDS,
      storeFields: MINISEARCH_STORE_FIELDS,
      searchOptions: MINISEARCH_SEARCH_OPTIONS,
    });
  }

  addChunks(chunks: Chunk[]): void {
    const documents: IndexedDocument[] = chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      nlSummary: chunk.nlSummary,
      filePath: chunk.filePath,
      name: chunk.metadata.name,
      chunkType: chunk.metadata.chunkType,
      language: chunk.language,
    }));

    this.miniSearch.addAll(documents);
  }

  removeChunks(ids: string[]): void {
    this.miniSearch.discardAll(ids);
  }

  search(query: string, topK: number): SearchResult[] {
    const results = this.miniSearch.search(query);

    return results.slice(0, topK).map((result) => {
      const storedContent = (result['content'] as string | undefined) ?? '';
      const storedNlSummary =
        (result['nlSummary'] as string | undefined) ?? '';
      const storedFilePath = (result['filePath'] as string | undefined) ?? '';
      const storedName = (result['name'] as string | undefined) ?? '';
      const storedChunkType =
        (result['chunkType'] as string | undefined) ?? 'function';
      const storedLanguage =
        (result['language'] as string | undefined) ?? 'unknown';

      const metadata: ChunkMetadata = {
        chunkType: storedChunkType as ChunkMetadata['chunkType'],
        name: storedName,
        declarations: [],
        imports: [],
        exports: [],
      };

      return {
        chunkId: result.id as string,
        content: storedContent,
        nlSummary: storedNlSummary,
        score: result.score,
        method: 'bm25' as const,
        metadata,
        chunk: {
          id: result.id as string,
          content: storedContent,
          nlSummary: storedNlSummary,
          filePath: storedFilePath,
          startLine: 0,
          endLine: 0,
          language: storedLanguage,
          metadata,
        },
      };
    });
  }

  serialize(): string {
    return JSON.stringify(this.miniSearch.toJSON());
  }

  static deserialize(json: string): BM25Index {
    const index = new BM25Index();
    index.miniSearch = MiniSearch.loadJSON<IndexedDocument>(json, {
      fields: MINISEARCH_FIELDS,
      storeFields: MINISEARCH_STORE_FIELDS,
      searchOptions: MINISEARCH_SEARCH_OPTIONS,
    });
    return index;
  }

  count(): number {
    return this.miniSearch.documentCount;
  }
}
