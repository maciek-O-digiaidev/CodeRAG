// Token efficiency benchmarking — barrel export

// Types
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
} from './types.js';

// Runner
export {
  runTokenBudgetBenchmark,
  aggregateBudgetMetrics,
} from './token-budget-runner.js';
export type { StrategyMap } from './token-budget-runner.js';

// Noise calculator
export {
  estimateTokenCount,
  computeNoiseRatio,
  computeTokenBreakdown,
} from './noise-calculator.js';
export type {
  ChunkTokenInfo,
  TokenBreakdown,
} from './noise-calculator.js';

// Efficiency analyzer
export {
  analyzeEfficiency,
  analyzeStrategyEfficiency,
  rankStrategiesByEfficiency,
  computeQualityAuc,
} from './efficiency-analyzer.js';

// CSV writer
export {
  writeBudgetMetricsCsv,
  writeEfficiencyAnalysisCsv,
  writeQualityCurveCsv,
  writeFullReportCsv,
} from './csv-writer.js';
