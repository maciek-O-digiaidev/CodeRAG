/**
 * Type definitions for the CodeSearchNet dataset adapter.
 *
 * CodeSearchNet (CSN) is a benchmark dataset of ~2M code-NL pairs across
 * 6 programming languages (Python, JavaScript, Ruby, Go, Java, PHP).
 * Each entry contains a function/method body and its NL docstring.
 *
 * @see https://github.com/github/CodeSearchNet
 */

/** Languages supported by the CodeSearchNet dataset. */
export const CSN_LANGUAGES = [
  'python',
  'javascript',
  'ruby',
  'go',
  'java',
  'php',
] as const;

export type CSNLanguage = (typeof CSN_LANGUAGES)[number];

/**
 * A single entry in a CodeSearchNet JSONL file.
 *
 * Each line in the JSONL file contains one function/method with its
 * NL documentation string (docstring) and metadata.
 */
export interface CSNEntry {
  /** Repository of origin, e.g. "user/repo". */
  readonly repo: string;
  /** Relative file path within the repository. */
  readonly path: string;
  /** Name of the function or method. */
  readonly func_name: string;
  /** The raw source code of the function. */
  readonly code: string;
  /** Tokenized code (space-separated). */
  readonly code_tokens: readonly string[];
  /** The NL docstring associated with the function. */
  readonly docstring: string;
  /** Tokenized docstring (space-separated). */
  readonly docstring_tokens: readonly string[];
  /** Programming language (matches CSNLanguage). */
  readonly language: string;
  /** SHA of the git commit the code was extracted from. */
  readonly sha: string;
  /** URL pointing to the code on GitHub. */
  readonly url: string;
  /** Partition: train, valid, or test. */
  readonly partition: string;
}

/**
 * A parsed CodeSearchNet dataset for one or more languages.
 */
export interface CSNDataset {
  /** The languages included in this dataset. */
  readonly languages: readonly CSNLanguage[];
  /** Entries grouped by language. */
  readonly entries: ReadonlyMap<CSNLanguage, readonly CSNEntry[]>;
  /** Total number of entries across all languages. */
  readonly totalEntries: number;
}

/**
 * Configuration for downloading and processing the CSN dataset.
 */
export interface CSNDownloadConfig {
  /** Languages to download. Defaults to all 6. */
  readonly languages: readonly CSNLanguage[];
  /** Directory to cache downloaded files. */
  readonly cacheDir: string;
  /** Only include the test partition (for evaluation). */
  readonly testOnly: boolean;
  /** Maximum entries per language (for CI subset runs). 0 = unlimited. */
  readonly maxEntriesPerLanguage: number;
}

/**
 * Configuration for CSN evaluation runs.
 */
export interface CSNEvaluationConfig {
  /** Languages to evaluate. */
  readonly languages: readonly CSNLanguage[];
  /** Maximum entries per language for evaluation. 0 = all entries. */
  readonly maxEntriesPerLanguage: number;
  /** Directory to write result files. */
  readonly outputDir: string;
}

/** Default base URL for CodeSearchNet GitHub releases. */
export const CSN_GITHUB_BASE_URL =
  'https://s3.amazonaws.com/code-search-net/CodeSearchNet/v2';

/** Default cache directory name (relative to project root). */
export const CSN_DEFAULT_CACHE_DIR = '.cache/codesearchnet';

/** Default output directory for results. */
export const CSN_DEFAULT_OUTPUT_DIR = 'results/codesearchnet';
