import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Result of checking whether a CodeRAG index exists at a given storage path.
 *
 * - `exists: false` — no index has been built (missing LanceDB data or BM25 file)
 * - `exists: true, empty: true` — index structure exists but contains 0 chunks
 * - `exists: true, empty: false` — index exists and has chunks
 */
export interface IndexCheckResult {
  readonly exists: boolean;
  readonly empty: boolean;
}

const BM25_INDEX_FILE = 'bm25-index.json';

/**
 * Check whether a CodeRAG index exists at the given storage path.
 *
 * Checks both:
 * 1. LanceDB directory exists and contains data (has subdirectories/files)
 * 2. BM25 index file exists (`bm25-index.json`)
 *
 * If both exist, reads the BM25 index to determine whether the index is empty
 * (0 documents) or populated.
 */
export async function checkIndexExists(storagePath: string): Promise<IndexCheckResult> {
  const NO_INDEX: IndexCheckResult = { exists: false, empty: false };

  // Check if the storage directory itself exists
  const dirExists = await fileExists(storagePath);
  if (!dirExists) {
    return NO_INDEX;
  }

  // Check if the directory has any LanceDB data (subdirectories or .lance files)
  const hasLanceData = await directoryHasContent(storagePath);
  if (!hasLanceData) {
    return NO_INDEX;
  }

  // Check if BM25 index file exists
  const bm25Path = join(storagePath, BM25_INDEX_FILE);
  const bm25Exists = await fileExists(bm25Path);
  if (!bm25Exists) {
    return NO_INDEX;
  }

  // Both exist; check if BM25 index has any documents
  const isEmpty = await isBm25Empty(bm25Path);

  return { exists: true, empty: isEmpty };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasContent(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    // Filter out just the BM25 file — we want actual LanceDB data
    const dataEntries = entries.filter((e) => e !== BM25_INDEX_FILE && e !== 'graph.json');
    return dataEntries.length > 0;
  } catch {
    return false;
  }
}

async function isBm25Empty(bm25Path: string): Promise<boolean> {
  try {
    const content = await readFile(bm25Path, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      // MiniSearch JSON has a `documentCount` field
      if (typeof record['documentCount'] === 'number') {
        return record['documentCount'] === 0;
      }
    }
    // If we cannot determine count, assume not empty (conservative)
    return false;
  } catch {
    // If BM25 file is corrupted or unreadable, treat as empty
    return true;
  }
}
