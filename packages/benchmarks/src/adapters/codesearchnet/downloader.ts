/**
 * CodeSearchNet dataset downloader and parser.
 *
 * Downloads JSONL files from the CodeSearchNet GitHub releases,
 * caches them locally, and parses them into typed CSNEntry arrays.
 *
 * All network operations return Result<T, Error> via neverthrow.
 * The downloader only fetches the test partition by default (for evaluation).
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { ok, err, ResultAsync, type Result } from 'neverthrow';
import type {
  CSNEntry,
  CSNLanguage,
  CSNDataset,
  CSNDownloadConfig,
} from './types.js';
import {
  CSN_LANGUAGES,
  CSN_GITHUB_BASE_URL,
  CSN_DEFAULT_CACHE_DIR,
} from './types.js';

/**
 * Build the download URL for a language's JSONL.gz file.
 */
export function buildDownloadUrl(language: CSNLanguage): string {
  return `${CSN_GITHUB_BASE_URL}/${language}.zip`;
}

/**
 * Build the expected local file path for a cached JSONL file.
 */
export function buildCachePath(cacheDir: string, language: CSNLanguage, partition: string): string {
  return join(cacheDir, language, `${partition}.jsonl`);
}

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Parse a single JSONL line into a CSNEntry.
 *
 * Returns err if the JSON is malformed or missing required fields.
 */
export function parseCSNLine(line: string): Result<CSNEntry, Error> {
  try {
    const parsed: unknown = JSON.parse(line);

    if (typeof parsed !== 'object' || parsed === null) {
      return err(new Error('Parsed value is not an object'));
    }

    const record = parsed as Record<string, unknown>;

    // Validate required fields
    const requiredStrings = ['repo', 'path', 'func_name', 'code', 'docstring', 'language', 'sha', 'url', 'partition'] as const;

    for (const field of requiredStrings) {
      if (typeof record[field] !== 'string') {
        return err(new Error(`Missing or invalid required field: ${field}`));
      }
    }

    const requiredArrays = ['code_tokens', 'docstring_tokens'] as const;

    for (const field of requiredArrays) {
      if (!Array.isArray(record[field])) {
        return err(new Error(`Missing or invalid required array field: ${field}`));
      }
    }

    return ok({
      repo: record['repo'] as string,
      path: record['path'] as string,
      func_name: record['func_name'] as string,
      code: record['code'] as string,
      code_tokens: record['code_tokens'] as string[],
      docstring: record['docstring'] as string,
      docstring_tokens: record['docstring_tokens'] as string[],
      language: record['language'] as string,
      sha: record['sha'] as string,
      url: record['url'] as string,
      partition: record['partition'] as string,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    return err(new Error(`Failed to parse JSONL line: ${message}`));
  }
}

/**
 * Parse a JSONL file content into an array of CSNEntry values.
 *
 * Skips empty lines and lines that fail to parse (logs a warning count).
 * Applies maxEntries limit if > 0.
 */
export function parseCSNJsonl(
  content: string,
  maxEntries: number = 0,
): { entries: CSNEntry[]; parseErrors: number } {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  const entries: CSNEntry[] = [];
  let parseErrors = 0;

  const limit = maxEntries > 0 ? maxEntries : lines.length;

  for (const line of lines) {
    if (entries.length >= limit) break;

    const result = parseCSNLine(line);
    if (result.isOk()) {
      entries.push(result.value);
    } else {
      parseErrors++;
    }
  }

  return { entries, parseErrors };
}

/**
 * Download a gzipped file from a URL and save it to disk.
 *
 * Uses Node.js native fetch + streaming pipeline.
 */
export async function downloadAndExtract(
  url: string,
  outputPath: string,
): Promise<Result<void, Error>> {
  try {
    const dirPath = outputPath.substring(0, outputPath.lastIndexOf('/'));
    await mkdir(dirPath, { recursive: true });

    const response = await fetch(url);
    if (!response.ok) {
      return err(new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`));
    }

    if (!response.body) {
      return err(new Error(`No response body for ${url}`));
    }

    const gunzip = createGunzip();
    const fileStream = createWriteStream(outputPath);

    // Web ReadableStream from fetch is compatible with pipeline in Node.js 18+
    await pipeline(response.body as unknown as NodeJS.ReadableStream, gunzip, fileStream);

    return ok(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown download error';
    return err(new Error(`Download failed for ${url}: ${message}`));
  }
}

/**
 * Load a JSONL file from the cache directory.
 *
 * Returns err if the file doesn't exist or can't be read.
 */
export function loadCachedJsonl(
  cacheDir: string,
  language: CSNLanguage,
  partition: string,
): ResultAsync<string, Error> {
  const filePath = buildCachePath(cacheDir, language, partition);

  return ResultAsync.fromPromise(
    readFile(filePath, 'utf-8'),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown read error';
      return new Error(`Failed to read cached file ${filePath}: ${message}`);
    },
  );
}

/**
 * Check which languages have cached test JSONL files.
 */
export async function getCachedLanguages(
  cacheDir: string,
  partition: string = 'test',
): Promise<CSNLanguage[]> {
  const cached: CSNLanguage[] = [];

  for (const lang of CSN_LANGUAGES) {
    const filePath = buildCachePath(cacheDir, lang, partition);
    if (await fileExists(filePath)) {
      cached.push(lang);
    }
  }

  return cached;
}

/**
 * Create a default download configuration.
 */
export function createDefaultDownloadConfig(
  overrides: Partial<CSNDownloadConfig> = {},
): CSNDownloadConfig {
  return {
    languages: overrides.languages ?? [...CSN_LANGUAGES],
    cacheDir: overrides.cacheDir ?? CSN_DEFAULT_CACHE_DIR,
    testOnly: overrides.testOnly ?? true,
    maxEntriesPerLanguage: overrides.maxEntriesPerLanguage ?? 0,
  };
}

/**
 * Load a CSN dataset from cached JSONL files.
 *
 * Loads the test partition by default. Returns the full CSNDataset
 * with entries grouped by language.
 */
export async function loadCSNDataset(
  config: CSNDownloadConfig,
): Promise<Result<CSNDataset, Error>> {
  const partition = config.testOnly ? 'test' : 'train';
  const entriesByLanguage = new Map<CSNLanguage, CSNEntry[]>();
  let totalEntries = 0;
  const loadedLanguages: CSNLanguage[] = [];

  for (const language of config.languages) {
    const contentResult = await loadCachedJsonl(config.cacheDir, language, partition);

    if (contentResult.isErr()) {
      return err(contentResult.error);
    }

    const { entries, parseErrors: _parseErrors } = parseCSNJsonl(
      contentResult.value,
      config.maxEntriesPerLanguage,
    );

    entriesByLanguage.set(language, entries);
    totalEntries += entries.length;
    loadedLanguages.push(language);
  }

  return ok({
    languages: loadedLanguages,
    entries: entriesByLanguage,
    totalEntries,
  });
}
