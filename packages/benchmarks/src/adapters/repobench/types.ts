/**
 * Type definitions for the RepoBench cross-file retrieval adapter.
 *
 * RepoBench is a benchmark for evaluating cross-file code completion and
 * retrieval. Each entry contains a code snippet with an import/dependency
 * and the ground-truth cross-file context that should be retrieved.
 *
 * Reference: https://github.com/Leolty/repobench
 * Dataset: https://huggingface.co/datasets/tianyang/repobench-r
 */

/** Supported programming languages in RepoBench. */
export type RepoBenchLanguage = 'python' | 'java';

/** Difficulty levels for RepoBench tasks. */
export type RepoBenchLevel = 'cross_file_first' | 'cross_file_random' | 'in_file';

/**
 * A single RepoBench entry as stored in the JSONL dataset.
 *
 * Each entry represents a code completion scenario where cross-file
 * context is needed to complete the target code.
 */
export interface RepoBenchEntry {
  /** Repository name (owner/repo format). */
  readonly repo_name: string;
  /** File path within the repository. */
  readonly file_path: string;
  /** The code context preceding the target line(s). */
  readonly context: string;
  /** The import statement(s) relevant to this entry. */
  readonly import_statement: string;
  /** The ground-truth code that follows (to be completed/retrieved). */
  readonly gold_snippet_code: string;
  /** Cross-file context snippets — the code from other files needed. */
  readonly cross_file_context: readonly RepoBenchCrossFileSnippet[];
}

/**
 * A cross-file code snippet that provides context for the entry.
 * This is the ground-truth "file to retrieve" in the retrieval task.
 */
export interface RepoBenchCrossFileSnippet {
  /** File path of the cross-file dependency. */
  readonly file_path: string;
  /** The relevant code snippet from the cross-file dependency. */
  readonly code: string;
}

/**
 * A RepoBench task adapted for CodeRAG evaluation.
 *
 * Converts the raw RepoBench entry into a retrieval query:
 * given the import statement and code context, retrieve the
 * correct cross-file dependency.
 */
export interface RepoBenchTask {
  /** Unique task identifier (repo_name + file_path + index). */
  readonly id: string;
  /** The retrieval query (derived from import_statement + context). */
  readonly query: string;
  /** Language of the source code. */
  readonly language: RepoBenchLanguage;
  /** Expected file paths to retrieve (ground truth). */
  readonly expectedFilePaths: readonly string[];
  /** Ground-truth code snippets for computing edit similarity. */
  readonly goldSnippets: readonly string[];
  /** Repository name. */
  readonly repoName: string;
  /** Source file path. */
  readonly sourceFilePath: string;
}

/**
 * Configuration for the RepoBench downloader.
 */
export interface RepoBenchDownloadConfig {
  /** Target directory for downloaded data. */
  readonly outputDir: string;
  /** Languages to download. */
  readonly languages: readonly RepoBenchLanguage[];
  /** Maximum entries per language (for limiting dataset size). */
  readonly maxEntriesPerLanguage?: number;
}

/**
 * RepoBench-specific evaluation metrics.
 */
export interface RepoBenchMetrics {
  /** Exact match rate: fraction of predictions matching gold exactly. */
  readonly exactMatch: number;
  /** Average edit similarity: 1 - (editDistance / maxLength). */
  readonly editSimilarity: number;
}

/**
 * Combined evaluation results for a RepoBench run.
 */
export interface RepoBenchEvaluationResult {
  /** RepoBench-specific metrics (exact match, edit similarity). */
  readonly repobenchMetrics: RepoBenchMetrics;
  /** Standard CodeRAG IR metrics (P@K, MRR, nDCG). */
  readonly irMetrics: {
    readonly precisionAt1: number;
    readonly precisionAt5: number;
    readonly precisionAt10: number;
    readonly mrr: number;
    readonly ndcgAt10: number;
  };
  /** Number of tasks evaluated. */
  readonly taskCount: number;
  /** Language breakdown. */
  readonly byLanguage: Readonly<Record<RepoBenchLanguage, RepoBenchMetrics>>;
}

/**
 * A published baseline result for comparison.
 */
export interface RepoBenchBaseline {
  /** Name of the model/system. */
  readonly name: string;
  /** Exact match score. */
  readonly exactMatch: number;
  /** Edit similarity score. */
  readonly editSimilarity: number;
  /** Language tested. */
  readonly language: RepoBenchLanguage;
  /** Source of the result (paper, leaderboard, etc.). */
  readonly source: string;
}

/**
 * HuggingFace dataset info for downloading.
 */
export interface HuggingFaceDatasetInfo {
  /** Dataset repository path on HuggingFace. */
  readonly repoPath: string;
  /** Specific configuration/subset name. */
  readonly config: string;
  /** Split to download (train, test, validation). */
  readonly split: string;
}
