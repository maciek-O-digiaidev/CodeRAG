/**
 * CodeSearchNet evaluation runner.
 *
 * Orchestrates the evaluation pipeline:
 * 1. Load CSN dataset (from cache)
 * 2. Build in-memory code corpus
 * 3. Adapt to GenericBenchmarkDataset
 * 4. Run metrics using the existing metrics runner
 * 5. Produce CSN-specific report with per-language breakdowns
 *
 * Uses the existing ir-metrics and metrics-runner infrastructure
 * for computing MRR, P@K, nDCG, and other standard metrics.
 */

import { ok, err, type Result } from 'neverthrow';
import { runMetrics } from '../../metrics/metrics-runner.js';
import type {
  MetricsReport,
  RetrievalFn,
  AggregateMetrics,
} from '../../metrics/types.js';
import { adaptCSNToGenericDataset, adaptCSNLanguageSubset } from './adapter.js';
import type { CodeCorpus } from './adapter.js';
import type {
  CSNDataset,
  CSNLanguage,
  CSNEvaluationConfig,
} from './types.js';
import { CSN_DEFAULT_OUTPUT_DIR } from './types.js';

/**
 * Per-language evaluation results.
 */
export interface CSNLanguageResult {
  readonly language: CSNLanguage;
  readonly report: MetricsReport;
}

/**
 * Full CSN evaluation report with per-language and aggregate results.
 */
export interface CSNEvaluationReport {
  /** Per-language metric reports. */
  readonly languageResults: readonly CSNLanguageResult[];
  /** Aggregate report across all languages. */
  readonly aggregateReport: MetricsReport;
  /** Aggregate metrics only (convenience accessor). */
  readonly aggregateMetrics: AggregateMetrics;
  /** Evaluation configuration used. */
  readonly config: CSNEvaluationConfig;
}

/**
 * Create a default evaluation configuration.
 */
export function createDefaultEvaluationConfig(
  overrides: Partial<CSNEvaluationConfig> = {},
): CSNEvaluationConfig {
  return {
    languages: overrides.languages ?? ['python'],
    maxEntriesPerLanguage: overrides.maxEntriesPerLanguage ?? 100,
    outputDir: overrides.outputDir ?? CSN_DEFAULT_OUTPUT_DIR,
  };
}

/**
 * Create a simple BM25-like text similarity retrieval function.
 *
 * This creates a basic retrieval function that scores corpus entries
 * by token overlap with the query. Used as a baseline / for testing
 * the evaluation pipeline itself.
 *
 * For real CodeRAG evaluation, replace this with a retrieval function
 * that calls the actual CodeRAG search engine.
 */
export function createTokenOverlapRetrievalFn(
  corpus: CodeCorpus,
  topK: number = 10,
): RetrievalFn {
  return async (query: string): Promise<readonly string[]> => {
    const queryTokens = new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1),
    );

    const scores: Array<{ id: string; score: number }> = [];

    for (const [chunkId, code] of corpus.chunks) {
      const codeTokens = code
        .toLowerCase()
        .split(/[\s(){}[\];,.:=<>!&|?/\\@#$%^*~`"'+\-]+/)
        .filter((t) => t.length > 1);

      let overlap = 0;
      for (const token of codeTokens) {
        if (queryTokens.has(token)) {
          overlap++;
        }
      }

      // Normalize by query token count to avoid bias towards long functions
      const score = queryTokens.size > 0 ? overlap / queryTokens.size : 0;

      if (score > 0) {
        scores.push({ id: chunkId, score });
      }
    }

    // Sort by score descending, then take top-K
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK).map((s) => s.id);
  };
}

/**
 * Evaluate a retrieval function against a CSN dataset for a single language.
 */
export async function evaluateLanguage(
  dataset: CSNDataset,
  language: CSNLanguage,
  retrievalFn: RetrievalFn,
  maxEntries: number = 0,
): Promise<Result<CSNLanguageResult, Error>> {
  const entries = dataset.entries.get(language);
  if (!entries || entries.length === 0) {
    return err(new Error(`No entries found for language: ${language}`));
  }

  const genericDataset = adaptCSNLanguageSubset(entries, language, {
    maxQueries: maxEntries,
  });

  if (genericDataset.queries.length === 0) {
    return err(new Error(`No valid queries for language: ${language} (all docstrings filtered)`));
  }

  const report = await runMetrics(
    genericDataset,
    retrievalFn,
    `CodeSearchNet-${language}`,
  );

  return ok({ language, report });
}

/**
 * Run full CSN evaluation across all configured languages.
 *
 * For each language:
 * 1. Adapt entries to GenericBenchmarkDataset
 * 2. Run retrieval function on each query
 * 3. Compute per-language metrics
 *
 * Then compute aggregate metrics across all languages.
 */
export async function evaluateCSN(
  dataset: CSNDataset,
  retrievalFn: RetrievalFn,
  config: CSNEvaluationConfig,
): Promise<Result<CSNEvaluationReport, Error>> {
  const languageResults: CSNLanguageResult[] = [];

  for (const language of config.languages) {
    const result = await evaluateLanguage(
      dataset,
      language,
      retrievalFn,
      config.maxEntriesPerLanguage,
    );

    if (result.isErr()) {
      return err(result.error);
    }

    languageResults.push(result.value);
  }

  if (languageResults.length === 0) {
    return err(new Error('No language results produced'));
  }

  // Compute aggregate report across all languages
  const allGenericDataset = adaptCSNToGenericDataset(dataset, {
    maxQueries: config.maxEntriesPerLanguage > 0
      ? config.maxEntriesPerLanguage * config.languages.length
      : 0,
  });

  const aggregateReport = await runMetrics(
    allGenericDataset,
    retrievalFn,
    'CodeSearchNet-aggregate',
  );

  return ok({
    languageResults,
    aggregateReport,
    aggregateMetrics: aggregateReport.aggregate,
    config,
  });
}

/**
 * Format a CSN evaluation report as JSON.
 */
export function formatCSNReportJson(report: CSNEvaluationReport): string {
  const output = {
    config: report.config,
    aggregate: {
      metrics: report.aggregateMetrics,
      queryCount: report.aggregateReport.metadata.queryCount,
      timestamp: report.aggregateReport.metadata.timestamp,
    },
    perLanguage: report.languageResults.map((lr) => ({
      language: lr.language,
      metrics: lr.report.aggregate,
      queryCount: lr.report.metadata.queryCount,
    })),
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Format a CSN evaluation report as Markdown.
 *
 * Produces a human-readable report with:
 * - Aggregate metrics table
 * - Per-language metrics table
 * - Comparison with published CodeSearchNet baselines
 */
export function formatCSNReportMarkdown(report: CSNEvaluationReport): string {
  const lines: string[] = [];

  lines.push('# CodeSearchNet Evaluation Report');
  lines.push('');
  lines.push(`**Date**: ${report.aggregateReport.metadata.timestamp.split('T')[0] ?? report.aggregateReport.metadata.timestamp}`);
  lines.push(`**Languages**: ${report.config.languages.join(', ')}`);
  lines.push(`**Max entries per language**: ${report.config.maxEntriesPerLanguage || 'unlimited'}`);
  lines.push(`**Total queries**: ${report.aggregateReport.metadata.queryCount}`);
  lines.push('');

  // Aggregate metrics
  lines.push('## Aggregate Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');

  const a = report.aggregateMetrics;
  lines.push(`| MRR | ${fmt(a.mrr)} |`);
  lines.push(`| Precision@5 | ${fmt(a.precisionAt5)} |`);
  lines.push(`| Precision@10 | ${fmt(a.precisionAt10)} |`);
  lines.push(`| Recall@5 | ${fmt(a.recallAt5)} |`);
  lines.push(`| Recall@10 | ${fmt(a.recallAt10)} |`);
  lines.push(`| nDCG@10 | ${fmt(a.ndcgAt10)} |`);
  lines.push(`| MAP | ${fmt(a.map)} |`);
  lines.push('');

  // Per-language breakdown
  if (report.languageResults.length > 1) {
    lines.push('## Per-Language Results');
    lines.push('');
    lines.push('| Language | MRR | P@5 | R@5 | nDCG@10 | MAP | Queries |');
    lines.push('|----------|-----|-----|-----|---------|-----|---------|');

    for (const lr of report.languageResults) {
      const m = lr.report.aggregate;
      lines.push(
        `| ${lr.language} | ${fmt(m.mrr)} | ${fmt(m.precisionAt5)} | ${fmt(m.recallAt5)} | ${fmt(m.ndcgAt10)} | ${fmt(m.map)} | ${lr.report.metadata.queryCount} |`,
      );
    }
    lines.push('');
  }

  // Published baselines reference
  lines.push('## CodeSearchNet Published Baselines (MRR)');
  lines.push('');
  lines.push('For reference, published baselines from the CodeSearchNet Challenge:');
  lines.push('');
  lines.push('| Model | Python | JavaScript | Ruby | Go | Java | PHP | Overall |');
  lines.push('|-------|--------|------------|------|----|------|-----|---------|');
  lines.push('| Neural BoW | 0.585 | 0.424 | 0.295 | 0.695 | 0.507 | 0.476 | 0.497 |');
  lines.push('| 1D-CNN | 0.575 | 0.413 | 0.277 | 0.680 | 0.498 | 0.466 | 0.485 |');
  lines.push('| biRNN | 0.577 | 0.416 | 0.275 | 0.688 | 0.497 | 0.465 | 0.486 |');
  lines.push('| SelfAtt | 0.599 | 0.435 | 0.308 | 0.709 | 0.517 | 0.485 | 0.509 |');
  lines.push('');

  return lines.join('\n');
}

function fmt(value: number): string {
  return value.toFixed(4);
}
