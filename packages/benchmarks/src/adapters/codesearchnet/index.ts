/**
 * CodeSearchNet dataset adapter for CodeRAG benchmarks.
 *
 * Provides download, adaptation, and evaluation of the CodeSearchNet
 * benchmark dataset against CodeRAG's search capabilities.
 */

// Types
export type {
  CSNLanguage,
  CSNEntry,
  CSNDataset,
  CSNDownloadConfig,
  CSNEvaluationConfig,
} from './types.js';
export { CSN_LANGUAGES, CSN_GITHUB_BASE_URL, CSN_DEFAULT_CACHE_DIR, CSN_DEFAULT_OUTPUT_DIR } from './types.js';

// Downloader
export {
  buildDownloadUrl,
  buildCachePath,
  parseCSNLine,
  parseCSNJsonl,
  downloadAndExtract,
  loadCachedJsonl,
  getCachedLanguages,
  createDefaultDownloadConfig,
  loadCSNDataset,
} from './downloader.js';

// Adapter
export {
  generateChunkId,
  buildCodeCorpus,
  filterByDocstringQuality,
  adaptCSNToGenericDataset,
  adaptCSNLanguageSubset,
} from './adapter.js';
export type { CodeCorpus } from './adapter.js';

// Evaluator
export {
  createDefaultEvaluationConfig,
  createTokenOverlapRetrievalFn,
  evaluateLanguage,
  evaluateCSN,
  formatCSNReportJson,
  formatCSNReportMarkdown,
} from './evaluator.js';
export type {
  CSNLanguageResult,
  CSNEvaluationReport,
} from './evaluator.js';
