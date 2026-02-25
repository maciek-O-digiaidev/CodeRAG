/**
 * CodeSearchNet to GenericBenchmarkDataset adapter.
 *
 * Converts CSN entries into the generic benchmark format used by the
 * metrics runner. Each CSN entry becomes a benchmark query where:
 * - query = NL docstring
 * - expected chunk ID = deterministic ID from repo + path + func_name
 *
 * Also provides an in-memory "code corpus" that maps chunk IDs to code,
 * simulating an indexed codebase for evaluation purposes.
 */

import type { GenericBenchmarkDataset, GenericBenchmarkQuery } from '../../metrics/types.js';
import type { CSNDataset, CSNEntry, CSNLanguage } from './types.js';

/**
 * Generate a deterministic chunk ID for a CSN entry.
 *
 * Format: `{language}:{repo}:{path}:{func_name}`
 * This ensures uniqueness across the entire dataset.
 */
export function generateChunkId(entry: CSNEntry): string {
  return `${entry.language}:${entry.repo}:${entry.path}:${entry.func_name}`;
}

/**
 * An in-memory code corpus mapping chunk IDs to their source code.
 *
 * This simulates the indexed codebase that CodeRAG would search against.
 * Used by the evaluator to create a simulated retrieval function.
 */
export interface CodeCorpus {
  /** Map from chunk ID to code content. */
  readonly chunks: ReadonlyMap<string, string>;
  /** Map from chunk ID to the full CSN entry. */
  readonly entries: ReadonlyMap<string, CSNEntry>;
  /** Total number of chunks in the corpus. */
  readonly size: number;
}

/**
 * Build an in-memory code corpus from a CSN dataset.
 *
 * Creates a mapping from chunk IDs to code content for all entries
 * in the dataset. This is used to simulate an indexed codebase.
 */
export function buildCodeCorpus(dataset: CSNDataset): CodeCorpus {
  const chunks = new Map<string, string>();
  const entries = new Map<string, CSNEntry>();

  for (const [_language, languageEntries] of dataset.entries) {
    for (const entry of languageEntries) {
      const chunkId = generateChunkId(entry);
      chunks.set(chunkId, entry.code);
      entries.set(chunkId, entry);
    }
  }

  return {
    chunks,
    entries,
    size: chunks.size,
  };
}

/**
 * Filter out entries with empty or very short docstrings.
 *
 * Short docstrings (less than minTokens tokens) are poor NL queries
 * and would produce noisy evaluation results.
 */
export function filterByDocstringQuality(
  entries: readonly CSNEntry[],
  minTokens: number = 3,
): CSNEntry[] {
  return entries.filter((entry) => {
    const docstring = entry.docstring.trim();
    if (docstring.length === 0) return false;

    // Count tokens (space-separated words)
    const tokenCount = entry.docstring_tokens.length;
    return tokenCount >= minTokens;
  });
}

/**
 * Convert a CSN dataset to GenericBenchmarkDataset.
 *
 * Each entry with a valid docstring becomes a benchmark query:
 * - query = the NL docstring (what someone might search for)
 * - expectedChunkIds = [chunk ID of the corresponding function]
 * - context = the actual code (for context_recall metric)
 *
 * Options:
 * - minDocstringTokens: minimum docstring length to include (default: 3)
 * - maxQueries: maximum number of queries (0 = unlimited, default: 0)
 */
export function adaptCSNToGenericDataset(
  dataset: CSNDataset,
  options: {
    readonly minDocstringTokens?: number;
    readonly maxQueries?: number;
  } = {},
): GenericBenchmarkDataset {
  const minTokens = options.minDocstringTokens ?? 3;
  const maxQueries = options.maxQueries ?? 0;

  const queries: GenericBenchmarkQuery[] = [];

  for (const [_language, entries] of dataset.entries) {
    const filtered = filterByDocstringQuality(entries, minTokens);

    for (const entry of filtered) {
      if (maxQueries > 0 && queries.length >= maxQueries) break;

      const chunkId = generateChunkId(entry);
      queries.push({
        query: entry.docstring,
        expectedChunkIds: [chunkId],
        context: entry.code,
      });
    }

    if (maxQueries > 0 && queries.length >= maxQueries) break;
  }

  return {
    queries,
    metadata: {
      source: 'CodeSearchNet',
      languages: [...dataset.languages],
      totalEntries: dataset.totalEntries,
      filteredQueries: queries.length,
      minDocstringTokens: minTokens,
    },
  };
}

/**
 * Adapt a single language subset of CSN entries to GenericBenchmarkDataset.
 *
 * Useful for running evaluation on one language at a time (e.g., Python-only for CI).
 */
export function adaptCSNLanguageSubset(
  entries: readonly CSNEntry[],
  language: CSNLanguage,
  options: {
    readonly minDocstringTokens?: number;
    readonly maxQueries?: number;
  } = {},
): GenericBenchmarkDataset {
  const minTokens = options.minDocstringTokens ?? 3;
  const maxQueries = options.maxQueries ?? 0;

  const filtered = filterByDocstringQuality(entries, minTokens);
  const limited = maxQueries > 0 ? filtered.slice(0, maxQueries) : filtered;

  const queries: GenericBenchmarkQuery[] = limited.map((entry) => {
    const chunkId = generateChunkId(entry);
    return {
      query: entry.docstring,
      expectedChunkIds: [chunkId],
      context: entry.code,
    };
  });

  return {
    queries,
    metadata: {
      source: 'CodeSearchNet',
      language,
      totalEntries: entries.length,
      filteredQueries: queries.length,
      minDocstringTokens: minTokens,
    },
  };
}
