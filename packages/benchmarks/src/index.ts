// @code-rag/benchmarks — benchmark suite for CodeRAG search quality and performance
export const BENCHMARKS_VERSION = '0.1.0';

// Types
export type {
  BenchmarkDataset,
  BenchmarkQuery,
  BenchmarkMetrics,
  BenchmarkReport,
  QueryRunResult,
  QueryDifficulty,
  QueryCategory,
  ChunkRelevance,
  ExpectedChunk,
} from './types.js';

// Metrics
export {
  precisionAtK,
  recallAtK,
  meanReciprocalRank,
  ndcg,
} from './metrics.js';

// Benchmark runner
export {
  runBenchmark,
  loadDataset,
  extractRelevantPaths,
  computeQueryMetrics,
  computeAggregateMetrics,
  generateMarkdownReport,
} from './benchmark.js';
export type { RunnerFn } from './benchmark.js';

// Runners
export { runGrepSearch, parseGrepOutput, rankByOccurrence } from './runners/grep-runner.js';
export type { GrepResult } from './runners/grep-runner.js';
export { runCodeRAGSearch } from './runners/coderag-runner.js';
export type { CodeRAGResult } from './runners/coderag-runner.js';

// Performance
export { measureTime, measureMemory, computePercentiles } from './perf/measure.js';
export {
  benchmarkQueryLatency,
  benchmarkIndexingSpeed,
  runPerfBenchmark,
} from './perf/perf-benchmark.js';
export type { LatencyResult, IndexingSpeedResult } from './perf/perf-benchmark.js';

// Generator — synthetic repo + query template engine
export { SeededRng, generateRepo, generateQueries } from './generator/index.js';
export type {
  RepoGeneratorOptions,
  SupportedLanguage,
  Complexity,
  GeneratedFile,
  ManifestEntity,
  RepoManifest,
  GeneratedRepo,
  QueryEngineOptions,
} from './generator/index.js';

// Portable IR Metrics Runner
export {
  precisionAtK as irPrecisionAtK,
  recallAtK as irRecallAtK,
  mrr as irMrr,
  ndcgAtK as irNdcgAtK,
  averagePrecision,
  contextPrecision,
  contextRecall,
} from './metrics/ir-metrics.js';
export {
  runMetrics,
  computeSingleQueryMetrics,
  computeAggregateMetrics as computeGenericAggregateMetrics,
  adaptLegacyDataset,
} from './metrics/metrics-runner.js';
export { writeJsonReport, writeMarkdownReport } from './metrics/report-writer.js';
export type {
  GenericBenchmarkQuery,
  GenericBenchmarkDataset,
  QueryMetricsResult,
  SingleQueryMetrics,
  AggregateMetrics as GenericAggregateMetrics,
  MetricsReport,
  ReportMetadata,
  RetrievalFn,
} from './metrics/types.js';

// Token Efficiency Benchmarking
export {
  runTokenBudgetBenchmark,
  aggregateBudgetMetrics,
  estimateTokenCount,
  computeNoiseRatio,
  computeTokenBreakdown,
  analyzeEfficiency,
  analyzeStrategyEfficiency,
  rankStrategiesByEfficiency,
  computeQualityAuc,
  writeBudgetMetricsCsv,
  writeEfficiencyAnalysisCsv,
  writeQualityCurveCsv,
  writeFullReportCsv,
} from './token-efficiency/index.js';
export type {
  StrategyName,
  TokenBudgetBenchmarkConfig,
  StrategyFn,
  StrategyResult,
  BudgetQueryResult,
  BudgetLevelMetrics,
  EfficiencyAnalysis,
  QualityCurvePoint,
  TokenEfficiencyReport,
  TokenEfficiencyMetadata,
  StrategyMap,
  ChunkTokenInfo,
  TokenBreakdown,
} from './token-efficiency/index.js';

// CodeSearchNet Adapter
export {
  CSN_LANGUAGES,
  CSN_GITHUB_BASE_URL,
  CSN_DEFAULT_CACHE_DIR,
  CSN_DEFAULT_OUTPUT_DIR,
  buildDownloadUrl,
  buildCachePath,
  parseCSNLine,
  parseCSNJsonl,
  downloadAndExtract,
  loadCachedJsonl,
  getCachedLanguages,
  createDefaultDownloadConfig,
  loadCSNDataset,
  generateChunkId,
  buildCodeCorpus,
  filterByDocstringQuality,
  adaptCSNToGenericDataset,
  adaptCSNLanguageSubset,
  createDefaultEvaluationConfig,
  createTokenOverlapRetrievalFn,
  evaluateLanguage,
  evaluateCSN,
  formatCSNReportJson,
  formatCSNReportMarkdown,
} from './adapters/codesearchnet/index.js';
export type {
  CSNLanguage,
  CSNEntry,
  CSNDataset,
  CSNDownloadConfig,
  CSNEvaluationConfig,
  CodeCorpus,
  CSNLanguageResult,
  CSNEvaluationReport,
} from './adapters/codesearchnet/index.js';

// RepoBench Cross-File Retrieval Adapter
export {
  buildApiUrl,
  parseRepoBenchRow,
  fetchRepoBenchEntries,
  downloadRepoBench,
  entryToTask,
  buildRetrievalQuery,
  truncateContext,
  entriesToTasks,
  tasksToDataset,
  convertToDataset,
  editDistance,
  editSimilarity,
  exactMatch,
  normalizeWhitespace,
  exactMatchRate,
  averageEditSimilarity,
  evaluateRepoBench,
  generateRepoBenchMarkdownReport,
  REPOBENCH_BASELINES,
  getBaselinesForLanguage,
  generateComparisonTable,
  DATASET_CONFIGS,
  MAX_ROWS_PER_REQUEST,
  HUGGINGFACE_API_BASE,
} from './adapters/repobench/index.js';
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
  DownloadError,
  EvaluationError,
  TaskEvaluationResult,
  RepoBenchReport,
  SnippetRetrievalFn,
} from './adapters/repobench/index.js';

// Utilities
export { extractKeywords } from './utils/extract-keywords.js';

// CI Benchmark Integration & Regression Detection
export {
  TRACKED_METRIC_NAMES,
  loadBaseline,
  saveBaseline,
  createBaseline,
  appendHistory,
  toHistoryEntry,
  DEFAULT_THRESHOLD_PERCENT,
  compareMetric,
  compareAllMetrics,
  detectRegressions,
  getRegressedMetricsSummary,
  formatMetricName,
  formatPRComment,
  formatHeader,
  formatMetricsTable,
  formatDelta,
  formatStatus,
  formatMetadata,
  formatStatusLine,
  formatStandaloneReport,
  DEFAULT_CI_CONFIG,
  runCIBenchmark,
  buildManifestRetrievalFn,
  scoreEntity,
  tokenize,
  runQuickValidation,
} from './ci/index.js';
export type {
  TrackedMetricName,
  BaselineData,
  CIBenchmarkResult,
  MetricComparison,
  RegressionReport,
  HistoryEntry,
  BaselineError,
  CIBenchmarkConfig,
  CIBenchmarkError,
} from './ci/index.js';
