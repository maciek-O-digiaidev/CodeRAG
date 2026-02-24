/**
 * CodeRAG search runner for benchmark comparison.
 *
 * Uses HybridSearch from @code-rag/core to search and returns
 * results with file paths and scores.
 */

import type { HybridSearch, SearchResult } from '@code-rag/core';

export interface CodeRAGResult {
  filePaths: string[];
  results: SearchResult[];
  durationMs: number;
}

/**
 * Run a CodeRAG hybrid search query and return ranked file paths.
 */
export async function runCodeRAGSearch(
  query: string,
  hybridSearch: HybridSearch,
  topK: number = 10,
): Promise<CodeRAGResult> {
  const start = performance.now();

  const searchResult = await hybridSearch.search(query, { topK });

  const durationMs = performance.now() - start;

  if (searchResult.isErr()) {
    return { filePaths: [], results: [], durationMs };
  }

  const results = searchResult.value;
  const filePaths = deduplicateFilePaths(results);

  return { filePaths, results, durationMs };
}

/**
 * Extract unique file paths from search results, preserving rank order.
 */
function deduplicateFilePaths(results: SearchResult[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const result of results) {
    const filePath = result.chunk?.filePath ?? '';
    if (filePath && !seen.has(filePath)) {
      seen.add(filePath);
      paths.push(filePath);
    }
  }

  return paths;
}
