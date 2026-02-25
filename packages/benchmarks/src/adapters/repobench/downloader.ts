/**
 * RepoBench dataset downloader.
 *
 * Downloads RepoBench JSONL data from HuggingFace datasets API.
 * Supports Python and Java languages with configurable entry limits.
 *
 * The RepoBench-R (retrieval) dataset is used for cross-file context evaluation.
 * Reference: https://huggingface.co/datasets/tianyang/repobench-r
 */

import { ok, err, Result, ResultAsync } from 'neverthrow';
import type {
  RepoBenchEntry,
  RepoBenchLanguage,
  RepoBenchDownloadConfig,
  HuggingFaceDatasetInfo,
} from './types.js';

/** Default HuggingFace API base URL. */
const HUGGINGFACE_API_BASE = 'https://datasets-server.huggingface.co';

/** Dataset configuration for each language in RepoBench-R. */
const DATASET_CONFIGS: Readonly<Record<RepoBenchLanguage, HuggingFaceDatasetInfo>> = {
  python: {
    repoPath: 'tianyang/repobench-r',
    config: 'cross_file_random',
    split: 'test',
  },
  java: {
    repoPath: 'tianyang/repobench-r',
    config: 'cross_file_random',
    split: 'test',
  },
};

/** Maximum number of rows per API request. */
const MAX_ROWS_PER_REQUEST = 100;

/** Error types for download operations. */
export type DownloadError =
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'parse'; readonly message: string }
  | { readonly kind: 'filesystem'; readonly message: string };

/**
 * Build the HuggingFace rows API URL for a given dataset config.
 */
export function buildApiUrl(
  info: HuggingFaceDatasetInfo,
  offset: number,
  length: number,
  baseUrl: string = HUGGINGFACE_API_BASE,
): string {
  const params = new URLSearchParams({
    dataset: info.repoPath,
    config: info.config,
    split: info.split,
    offset: String(offset),
    length: String(Math.min(length, MAX_ROWS_PER_REQUEST)),
  });
  return `${baseUrl}/rows?${params.toString()}`;
}

/**
 * Parse a single row from the HuggingFace API response into a RepoBenchEntry.
 *
 * Returns err if the row does not conform to the expected schema.
 */
export function parseRepoBenchRow(
  row: Readonly<Record<string, unknown>>,
): Result<RepoBenchEntry, DownloadError> {
  const repoName = row['repo_name'];
  const filePath = row['file_path'];
  const context = row['context'];
  const importStatement = row['import_statement'];
  const goldSnippetCode = row['gold_snippet_code'];
  const crossFileContext = row['cross_file_context'];

  if (
    typeof repoName !== 'string' ||
    typeof filePath !== 'string' ||
    typeof context !== 'string' ||
    typeof importStatement !== 'string' ||
    typeof goldSnippetCode !== 'string'
  ) {
    return err({
      kind: 'parse',
      message: `Invalid row: missing required string fields. Got keys: ${Object.keys(row).join(', ')}`,
    });
  }

  const parsedCrossFile = parseCrossFileContext(crossFileContext);
  if (parsedCrossFile.isErr()) {
    return err(parsedCrossFile.error);
  }

  return ok({
    repo_name: repoName,
    file_path: filePath,
    context,
    import_statement: importStatement,
    gold_snippet_code: goldSnippetCode,
    cross_file_context: parsedCrossFile.value,
  });
}

/**
 * Parse the cross_file_context field which can be an array of objects.
 */
function parseCrossFileContext(
  value: unknown,
): Result<readonly { file_path: string; code: string }[], DownloadError> {
  if (!Array.isArray(value)) {
    return ok([]);
  }

  const result: { file_path: string; code: string }[] = [];
  for (const item of value) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'file_path' in item &&
      'code' in item &&
      typeof (item as Record<string, unknown>)['file_path'] === 'string' &&
      typeof (item as Record<string, unknown>)['code'] === 'string'
    ) {
      result.push({
        file_path: (item as Record<string, unknown>)['file_path'] as string,
        code: (item as Record<string, unknown>)['code'] as string,
      });
    }
  }

  return ok(result);
}

/**
 * Fetch RepoBench entries from the HuggingFace API.
 *
 * Uses the HuggingFace datasets server rows API to download entries
 * for a specific language configuration.
 *
 * @param language - The programming language to fetch
 * @param maxEntries - Maximum number of entries to fetch (default: 100)
 * @param fetchFn - Fetch function for dependency injection (testing)
 * @returns Result containing parsed entries or a download error
 */
export function fetchRepoBenchEntries(
  language: RepoBenchLanguage,
  maxEntries: number = MAX_ROWS_PER_REQUEST,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): ResultAsync<readonly RepoBenchEntry[], DownloadError> {
  const config = DATASET_CONFIGS[language];
  const url = buildApiUrl(config, 0, maxEntries);

  return ResultAsync.fromPromise(
    fetchFn(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json() as Promise<unknown>;
    }),
    (error): DownloadError => ({
      kind: 'network',
      message: error instanceof Error ? error.message : String(error),
    }),
  ).andThen((json) => parseApiResponse(json));
}

/**
 * Parse the HuggingFace API response containing rows.
 */
function parseApiResponse(
  json: unknown,
): Result<readonly RepoBenchEntry[], DownloadError> {
  if (
    typeof json !== 'object' ||
    json === null ||
    !('rows' in json)
  ) {
    return err({
      kind: 'parse',
      message: 'API response missing "rows" field',
    });
  }

  const responseRows = (json as Record<string, unknown>)['rows'];
  if (!Array.isArray(responseRows)) {
    return err({
      kind: 'parse',
      message: '"rows" field is not an array',
    });
  }

  const entries: RepoBenchEntry[] = [];
  for (const wrapper of responseRows) {
    // HuggingFace rows API wraps each row in { row_idx, row, truncated_cells }
    const rowData = (
      typeof wrapper === 'object' &&
      wrapper !== null &&
      'row' in wrapper
    )
      ? (wrapper as Record<string, unknown>)['row'] as Record<string, unknown>
      : wrapper as Record<string, unknown>;

    const parseResult = parseRepoBenchRow(rowData);
    if (parseResult.isOk()) {
      entries.push(parseResult.value);
    }
    // Skip unparseable rows silently (partial success strategy)
  }

  return ok(entries);
}

/**
 * Download RepoBench dataset for all configured languages.
 *
 * @param config - Download configuration
 * @param fetchFn - Fetch function for dependency injection (testing)
 * @returns Map of language to parsed entries
 */
export function downloadRepoBench(
  config: RepoBenchDownloadConfig,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): ResultAsync<ReadonlyMap<RepoBenchLanguage, readonly RepoBenchEntry[]>, DownloadError> {
  const languageFetches = config.languages.map((lang) =>
    fetchRepoBenchEntries(
      lang,
      config.maxEntriesPerLanguage ?? MAX_ROWS_PER_REQUEST,
      fetchFn,
    ).map((entries): [RepoBenchLanguage, readonly RepoBenchEntry[]] => [lang, entries]),
  );

  return ResultAsync.combine(languageFetches).map(
    (pairs) => new Map(pairs),
  );
}

export { DATASET_CONFIGS, MAX_ROWS_PER_REQUEST, HUGGINGFACE_API_BASE };
