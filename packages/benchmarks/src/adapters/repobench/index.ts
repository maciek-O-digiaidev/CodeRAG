/**
 * RepoBench Cross-File Retrieval Adapter — barrel export.
 *
 * Provides everything needed to evaluate CodeRAG against the RepoBench
 * benchmark for cross-file code retrieval.
 */

// Types
export type {
  RepoBenchLanguage,
  RepoBenchLevel,
  RepoBenchEntry,
  RepoBenchCrossFileSnippet,
  RepoBenchTask,
  RepoBenchDownloadConfig,
  RepoBenchMetrics,
  RepoBenchEvaluationResult,
  RepoBenchBaseline,
  HuggingFaceDatasetInfo,
} from './types.js';

// Downloader
export {
  buildApiUrl,
  parseRepoBenchRow,
  fetchRepoBenchEntries,
  downloadRepoBench,
  DATASET_CONFIGS,
  MAX_ROWS_PER_REQUEST,
  HUGGINGFACE_API_BASE,
} from './downloader.js';
export type { DownloadError } from './downloader.js';

// Adapter
export {
  entryToTask,
  buildRetrievalQuery,
  truncateContext,
  entriesToTasks,
  tasksToDataset,
  convertToDataset,
} from './adapter.js';

// Similarity Metrics
export {
  editDistance,
  editSimilarity,
  exactMatch,
  normalizeWhitespace,
  exactMatchRate,
  averageEditSimilarity,
} from './similarity-metrics.js';

// Evaluator
export {
  evaluateRepoBench,
  generateRepoBenchMarkdownReport,
} from './evaluator.js';
export type {
  EvaluationError,
  TaskEvaluationResult,
  RepoBenchReport,
  SnippetRetrievalFn,
} from './evaluator.js';

// Baselines
export {
  REPOBENCH_BASELINES,
  getBaselinesForLanguage,
  generateComparisonTable,
} from './baselines.js';
