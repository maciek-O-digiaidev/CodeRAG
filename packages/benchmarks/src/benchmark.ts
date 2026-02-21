/**
 * Benchmark runner that compares CodeRAG search against grep baselines.
 *
 * Loads the dataset, runs each query against each runner, computes metrics,
 * and outputs a JSON report with a markdown summary table.
 */

import { readFile } from 'node:fs/promises';
import { precisionAtK, recallAtK, meanReciprocalRank, ndcg } from './metrics.js';
import type {
  BenchmarkDataset,
  BenchmarkQuery,
  BenchmarkMetrics,
  BenchmarkReport,
  QueryRunResult,
} from './types.js';

/** A runner function: given a query string, return ranked file paths and duration. */
export type RunnerFn = (
  query: string,
) => Promise<{ filePaths: string[]; durationMs: number }>;

/**
 * Load a benchmark dataset from a JSON file path.
 */
export async function loadDataset(filePath: string): Promise<BenchmarkDataset> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as BenchmarkDataset;
}

/**
 * Extract the relevant file paths from a benchmark query's expected chunks.
 */
export function extractRelevantPaths(query: BenchmarkQuery): string[] {
  return query.expectedChunks.map((chunk) => chunk.filePath);
}

/**
 * Compute all metrics for a single query result.
 */
export function computeQueryMetrics(
  retrieved: string[],
  relevant: string[],
): BenchmarkMetrics {
  return {
    precisionAt5: precisionAtK(retrieved, relevant, 5),
    precisionAt10: precisionAtK(retrieved, relevant, 10),
    recallAt5: recallAtK(retrieved, relevant, 5),
    recallAt10: recallAtK(retrieved, relevant, 10),
    mrr: meanReciprocalRank(retrieved, relevant),
    ndcgAt10: ndcg(retrieved, relevant, 10),
  };
}

/**
 * Compute aggregate metrics by averaging across all query results.
 */
export function computeAggregateMetrics(
  queryResults: QueryRunResult[],
): BenchmarkMetrics {
  if (queryResults.length === 0) {
    return {
      precisionAt5: 0,
      precisionAt10: 0,
      recallAt5: 0,
      recallAt10: 0,
      mrr: 0,
      ndcgAt10: 0,
    };
  }

  const sum: BenchmarkMetrics = {
    precisionAt5: 0,
    precisionAt10: 0,
    recallAt5: 0,
    recallAt10: 0,
    mrr: 0,
    ndcgAt10: 0,
  };

  for (const result of queryResults) {
    sum.precisionAt5 += result.metrics.precisionAt5;
    sum.precisionAt10 += result.metrics.precisionAt10;
    sum.recallAt5 += result.metrics.recallAt5;
    sum.recallAt10 += result.metrics.recallAt10;
    sum.mrr += result.metrics.mrr;
    sum.ndcgAt10 += result.metrics.ndcgAt10;
  }

  const count = queryResults.length;
  return {
    precisionAt5: sum.precisionAt5 / count,
    precisionAt10: sum.precisionAt10 / count,
    recallAt5: sum.recallAt5 / count,
    recallAt10: sum.recallAt10 / count,
    mrr: sum.mrr / count,
    ndcgAt10: sum.ndcgAt10 / count,
  };
}

/**
 * Generate a markdown summary table from multiple benchmark reports.
 */
export function generateMarkdownReport(reports: BenchmarkReport[]): string {
  const lines: string[] = [];

  lines.push('# Benchmark Results');
  lines.push('');
  lines.push(`Date: ${new Date().toISOString().split('T')[0]}`);
  lines.push('');
  lines.push('## Aggregate Metrics');
  lines.push('');
  lines.push(
    '| Runner | P@5 | P@10 | R@5 | R@10 | MRR | nDCG@10 | Queries |',
  );
  lines.push(
    '|--------|-----|------|-----|------|-----|---------|---------|',
  );

  for (const report of reports) {
    const m = report.aggregateMetrics;
    lines.push(
      `| ${report.runner} | ${fmt(m.precisionAt5)} | ${fmt(m.precisionAt10)} | ${fmt(m.recallAt5)} | ${fmt(m.recallAt10)} | ${fmt(m.mrr)} | ${fmt(m.ndcgAt10)} | ${report.totalQueries} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function fmt(value: number): string {
  return value.toFixed(4);
}

/**
 * Run a full benchmark: load dataset, execute runner on each query, compute metrics.
 */
export async function runBenchmark(
  datasetPath: string,
  runnerName: string,
  runnerFn: RunnerFn,
): Promise<BenchmarkReport> {
  const dataset = await loadDataset(datasetPath);
  const queryResults: QueryRunResult[] = [];

  for (const query of dataset.queries) {
    const relevant = extractRelevantPaths(query);
    const { filePaths, durationMs } = await runnerFn(query.query);
    const metrics = computeQueryMetrics(filePaths, relevant);

    queryResults.push({
      queryId: query.id,
      query: query.query,
      retrievedPaths: filePaths,
      relevantPaths: relevant,
      durationMs,
      metrics,
    });
  }

  const aggregateMetrics = computeAggregateMetrics(queryResults);

  return {
    runner: runnerName,
    timestamp: new Date().toISOString(),
    totalQueries: queryResults.length,
    aggregateMetrics,
    queryResults,
  };
}
