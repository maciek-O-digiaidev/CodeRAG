/**
 * RepoBench evaluation pipeline.
 *
 * Combines RepoBench-specific metrics (Exact Match, Edit Similarity)
 * with CodeRAG standard IR metrics (P@K, MRR, nDCG) to produce a
 * comprehensive evaluation report.
 *
 * Also generates comparison tables against published baselines.
 */

import { errAsync, ResultAsync } from 'neverthrow';
import type {
  RepoBenchTask,
  RepoBenchLanguage,
  RepoBenchMetrics,
  RepoBenchEvaluationResult,
} from './types.js';
import type { GenericBenchmarkDataset, MetricsReport, RetrievalFn } from '../../metrics/types.js';
import { runMetrics } from '../../metrics/metrics-runner.js';
import { precisionAtK, mrr } from '../../metrics/ir-metrics.js';
import { exactMatchRate, averageEditSimilarity } from './similarity-metrics.js';
import { tasksToDataset } from './adapter.js';
import { generateComparisonTable } from './baselines.js';

/** Error types for evaluation operations. */
export type EvaluationError =
  | { readonly kind: 'no_tasks'; readonly message: string }
  | { readonly kind: 'retrieval_failed'; readonly message: string };

/**
 * Result of evaluating a single RepoBench task.
 */
export interface TaskEvaluationResult {
  /** Task ID. */
  readonly taskId: string;
  /** Retrieved file paths from CodeRAG. */
  readonly retrievedPaths: readonly string[];
  /** Expected file paths (ground truth). */
  readonly expectedPaths: readonly string[];
  /** Retrieved code snippets (for edit similarity). */
  readonly retrievedSnippets: readonly string[];
  /** Gold code snippets. */
  readonly goldSnippets: readonly string[];
  /** Per-task RepoBench metrics. */
  readonly repobenchMetrics: RepoBenchMetrics;
  /** Per-task IR metrics. */
  readonly irMetrics: {
    readonly precisionAt1: number;
    readonly precisionAt5: number;
    readonly mrr: number;
  };
}

/**
 * Full RepoBench evaluation report.
 */
export interface RepoBenchReport {
  /** Combined evaluation result with aggregated metrics. */
  readonly evaluation: RepoBenchEvaluationResult;
  /** CodeRAG standard metrics report from the portable runner. */
  readonly irReport: MetricsReport;
  /** Per-task evaluation details. */
  readonly taskResults: readonly TaskEvaluationResult[];
  /** Comparison tables against baselines (markdown). */
  readonly comparisonTables: Readonly<Record<string, string>>;
  /** Timestamp. */
  readonly timestamp: string;
}

/**
 * A retrieval function that also returns code snippets.
 * Used for edit similarity computation.
 */
export type SnippetRetrievalFn = (query: string) => Promise<{
  readonly paths: readonly string[];
  readonly snippets: readonly string[];
}>;

/**
 * Evaluate RepoBench tasks using CodeRAG retrieval.
 *
 * Runs the full evaluation pipeline:
 * 1. Retrieve results for each task
 * 2. Compute RepoBench-specific metrics (EM + ES)
 * 3. Compute CodeRAG standard IR metrics (P@K, MRR, nDCG)
 * 4. Generate comparison tables against baselines
 *
 * @param tasks - RepoBench tasks to evaluate
 * @param retrievalFn - CodeRAG retrieval function (paths only, for IR metrics)
 * @param snippetRetrievalFn - Optional retrieval function that also returns snippets
 * @returns Full evaluation report or error
 */
export function evaluateRepoBench(
  tasks: readonly RepoBenchTask[],
  retrievalFn: RetrievalFn,
  snippetRetrievalFn?: SnippetRetrievalFn,
): ResultAsync<RepoBenchReport, EvaluationError> {
  if (tasks.length === 0) {
    return errAsync({ kind: 'no_tasks' as const, message: 'No tasks to evaluate' });
  }

  return ResultAsync.fromPromise(
    runEvaluation(tasks, retrievalFn, snippetRetrievalFn),
    (error): EvaluationError => ({
      kind: 'retrieval_failed',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

/**
 * Internal evaluation runner.
 */
async function runEvaluation(
  tasks: readonly RepoBenchTask[],
  retrievalFn: RetrievalFn,
  snippetRetrievalFn?: SnippetRetrievalFn,
): Promise<RepoBenchReport> {
  // Step 1: Run standard IR metrics using the portable runner
  const dataset: GenericBenchmarkDataset = tasksToDataset(tasks, 'repobench-r');
  const irReport = await runMetrics(dataset, retrievalFn, 'repobench-r');

  // Step 2: Evaluate each task individually for RepoBench-specific metrics
  const taskResults: TaskEvaluationResult[] = [];
  const editPairs: [string, string][] = [];
  const emPairs: [string, string][] = [];

  for (const task of tasks) {
    let retrievedPaths: readonly string[];
    let retrievedSnippets: readonly string[];

    if (snippetRetrievalFn) {
      const result = await snippetRetrievalFn(task.query);
      retrievedPaths = result.paths;
      retrievedSnippets = result.snippets;
    } else {
      retrievedPaths = await retrievalFn(task.query);
      retrievedSnippets = [];
    }

    // Compute per-task RepoBench metrics
    const relevantSet = new Set(task.expectedFilePaths);
    const taskEmPairs: [string, string][] = [];
    const taskEsPairs: [string, string][] = [];

    // Match retrieved snippets against gold snippets
    for (let i = 0; i < task.goldSnippets.length; i++) {
      const goldSnippet = task.goldSnippets[i];
      if (goldSnippet === undefined) continue;

      const retrievedSnippet = retrievedSnippets[i] ?? '';
      taskEmPairs.push([retrievedSnippet, goldSnippet]);
      taskEsPairs.push([retrievedSnippet, goldSnippet]);
    }

    emPairs.push(...taskEmPairs);
    editPairs.push(...taskEsPairs);

    const taskRepobenchMetrics: RepoBenchMetrics = {
      exactMatch: exactMatchRate(taskEmPairs),
      editSimilarity: averageEditSimilarity(taskEsPairs),
    };

    const taskIrMetrics = {
      precisionAt1: precisionAtK(retrievedPaths, relevantSet, 1),
      precisionAt5: precisionAtK(retrievedPaths, relevantSet, 5),
      mrr: mrr(retrievedPaths, relevantSet),
    };

    taskResults.push({
      taskId: task.id,
      retrievedPaths,
      expectedPaths: task.expectedFilePaths,
      retrievedSnippets,
      goldSnippets: task.goldSnippets,
      repobenchMetrics: taskRepobenchMetrics,
      irMetrics: taskIrMetrics,
    });
  }

  // Step 3: Compute aggregate RepoBench metrics
  const overallRepobenchMetrics: RepoBenchMetrics = {
    exactMatch: exactMatchRate(emPairs),
    editSimilarity: averageEditSimilarity(editPairs),
  };

  // Step 4: Compute per-language breakdown
  const byLanguage = computePerLanguageMetrics(tasks, taskResults);

  // Step 5: Compute aggregate IR metrics from task results
  const allRetrieved = taskResults.flatMap((r) => [...r.retrievedPaths]);
  const allExpected = new Set(tasks.flatMap((t) => [...t.expectedFilePaths]));

  const evaluation: RepoBenchEvaluationResult = {
    repobenchMetrics: overallRepobenchMetrics,
    irMetrics: {
      precisionAt1: irReport.aggregate.precisionAt5 > 0
        ? precisionAtK(allRetrieved, allExpected, 1)
        : 0,
      precisionAt5: irReport.aggregate.precisionAt5,
      precisionAt10: irReport.aggregate.precisionAt10,
      mrr: irReport.aggregate.mrr,
      ndcgAt10: irReport.aggregate.ndcgAt10,
    },
    taskCount: tasks.length,
    byLanguage,
  };

  // Step 6: Generate comparison tables
  const comparisonTables: Record<string, string> = {};
  const languages = [...new Set(tasks.map((t) => t.language))];
  for (const lang of languages) {
    const langTasks = taskResults.filter((_, i) => tasks[i]?.language === lang);
    if (langTasks.length > 0) {
      const langEmPairs: [string, string][] = [];
      const langEsPairs: [string, string][] = [];
      for (const result of langTasks) {
        for (let i = 0; i < result.goldSnippets.length; i++) {
          const gold = result.goldSnippets[i];
          if (gold === undefined) continue;
          const predicted = result.retrievedSnippets[i] ?? '';
          langEmPairs.push([predicted, gold]);
          langEsPairs.push([predicted, gold]);
        }
      }

      comparisonTables[lang] = generateComparisonTable(
        exactMatchRate(langEmPairs),
        averageEditSimilarity(langEsPairs),
        lang,
      );
    }
  }

  return {
    evaluation,
    irReport,
    taskResults,
    comparisonTables,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compute RepoBench metrics for each language separately.
 */
function computePerLanguageMetrics(
  tasks: readonly RepoBenchTask[],
  results: readonly TaskEvaluationResult[],
): Record<RepoBenchLanguage, RepoBenchMetrics> {
  const byLang: Record<RepoBenchLanguage, { em: [string, string][]; es: [string, string][] }> = {
    python: { em: [], es: [] },
    java: { em: [], es: [] },
  };

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const result = results[i];
    if (!task || !result) continue;

    for (let j = 0; j < result.goldSnippets.length; j++) {
      const gold = result.goldSnippets[j];
      if (gold === undefined) continue;
      const predicted = result.retrievedSnippets[j] ?? '';
      byLang[task.language].em.push([predicted, gold]);
      byLang[task.language].es.push([predicted, gold]);
    }
  }

  return {
    python: {
      exactMatch: exactMatchRate(byLang.python.em),
      editSimilarity: averageEditSimilarity(byLang.python.es),
    },
    java: {
      exactMatch: exactMatchRate(byLang.java.em),
      editSimilarity: averageEditSimilarity(byLang.java.es),
    },
  };
}

/**
 * Generate a full markdown report for RepoBench evaluation.
 *
 * Includes:
 * - Summary metrics
 * - Per-language breakdown
 * - Comparison tables against baselines
 * - CodeRAG standard IR metrics
 */
export function generateRepoBenchMarkdownReport(report: RepoBenchReport): string {
  const lines: string[] = [];

  lines.push('# RepoBench Cross-File Retrieval Evaluation');
  lines.push('');
  lines.push(`**Date**: ${report.timestamp.split('T')[0] ?? report.timestamp}`);
  lines.push(`**Tasks evaluated**: ${report.evaluation.taskCount}`);
  lines.push('');

  // RepoBench-specific metrics
  lines.push('## RepoBench Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Exact Match | ${fmtPct(report.evaluation.repobenchMetrics.exactMatch)} |`);
  lines.push(`| Edit Similarity | ${fmtPct(report.evaluation.repobenchMetrics.editSimilarity)} |`);
  lines.push('');

  // IR metrics
  lines.push('## CodeRAG IR Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Precision@1 | ${fmtPct(report.evaluation.irMetrics.precisionAt1)} |`);
  lines.push(`| Precision@5 | ${fmtPct(report.evaluation.irMetrics.precisionAt5)} |`);
  lines.push(`| Precision@10 | ${fmtPct(report.evaluation.irMetrics.precisionAt10)} |`);
  lines.push(`| MRR | ${fmtPct(report.evaluation.irMetrics.mrr)} |`);
  lines.push(`| nDCG@10 | ${fmtPct(report.evaluation.irMetrics.ndcgAt10)} |`);
  lines.push('');

  // Per-language breakdown
  lines.push('## Per-Language Breakdown');
  lines.push('');
  lines.push('| Language | Exact Match | Edit Similarity |');
  lines.push('|----------|-------------|-----------------|');
  for (const [lang, metrics] of Object.entries(report.evaluation.byLanguage)) {
    lines.push(`| ${lang} | ${fmtPct(metrics.exactMatch)} | ${fmtPct(metrics.editSimilarity)} |`);
  }
  lines.push('');

  // Comparison tables
  for (const table of Object.values(report.comparisonTables)) {
    lines.push(table);
  }

  return lines.join('\n');
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
