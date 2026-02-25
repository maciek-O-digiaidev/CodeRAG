/**
 * CLI command: coderag benchmark
 *
 * Auto-generates a benchmark dataset from an indexed project and evaluates
 * CodeRAG search quality against it. Optionally compares against a grep
 * baseline and runs token efficiency analysis across budget levels.
 *
 * Prints a unified summary table and optionally saves a detailed JSON report.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import {
  createRuntime,
  parseIndexRows,
  buildCallerMap,
  buildTestMap,
  generateQueries,
  runBenchmark,
} from '@code-rag/core';
import type { GraphEdge, BenchmarkReport, IndexScanResult } from '@code-rag/core';
import {
  extractKeywords,
  runGrepSearch,
  estimateTokenCount,
  runTokenBudgetBenchmark,
} from '@code-rag/benchmarks';
import type {
  TokenEfficiencyReport,
  StrategyFn,
  StrategyMap,
} from '@code-rag/benchmarks';

/** Default token budgets to evaluate. */
const DEFAULT_TOKEN_BUDGETS = [1000, 2000, 4000, 8000, 16000];

/** Grep comparison metrics for a single query. */
interface GrepQueryResult {
  readonly query: string;
  readonly grepFiles: readonly string[];
  readonly coderagFiles: readonly string[];
  readonly grepDurationMs: number;
  readonly coderagDurationMs: number;
}

/** Aggregate grep vs CodeRAG comparison. */
export interface GrepComparisonReport {
  readonly queryCount: number;
  readonly coderagMeanFiles: number;
  readonly grepMeanFiles: number;
  readonly coderagOnlyFiles: number;
  readonly grepOnlyFiles: number;
  readonly overlapFiles: number;
  readonly coderagMeanDurationMs: number;
  readonly grepMeanDurationMs: number;
  readonly perQuery: readonly GrepQueryResult[];
}

/**
 * Map chunk IDs to file paths using the index scan entity map.
 * Returns unique, sorted file paths.
 */
export function chunkIdsToFilePaths(
  chunkIds: readonly string[],
  entityMap: ReadonlyMap<string, { readonly filePath: string }>,
): string[] {
  const paths = new Set<string>();
  for (const id of chunkIds) {
    const entity = entityMap.get(id);
    if (entity) {
      paths.add(entity.filePath);
    }
  }
  return [...paths].sort();
}

/**
 * Format a BenchmarkReport as a colored terminal summary.
 */
export function formatColoredSummary(report: BenchmarkReport): string {
  const lines: string[] = [];
  const a = report.aggregate;

  lines.push(chalk.bold('Benchmark Results'));
  lines.push(chalk.dim('================='));
  lines.push(`Queries:    ${chalk.cyan(String(report.metadata.totalQueries))}`);
  lines.push(`Index size: ${chalk.cyan(String(report.metadata.totalChunksInIndex))} chunks`);
  lines.push(`Duration:   ${chalk.cyan((report.metadata.durationMs / 1000).toFixed(1))}s`);
  lines.push('');
  lines.push(chalk.bold('Aggregate Metrics:'));
  lines.push(`  P@5:       ${colorMetric(a.precisionAt5)}`);
  lines.push(`  P@10:      ${colorMetric(a.precisionAt10)}`);
  lines.push(`  Recall@10: ${colorMetric(a.recallAt10)}`);
  lines.push(`  MRR:       ${colorMetric(a.mrr)}`);
  lines.push(`  nDCG@10:   ${colorMetric(a.ndcgAt10)}`);

  if (report.byQueryType.length > 0) {
    lines.push('');
    lines.push(chalk.bold('By Query Type:'));
    lines.push(chalk.dim('  Type                 | Count |  P@5  | P@10  | R@10  |  MRR  | nDCG@10'));
    lines.push(chalk.dim('  ---------------------|-------|-------|-------|-------|-------|--------'));
    for (const bt of report.byQueryType) {
      const m = bt.metrics;
      const type = bt.queryType.padEnd(20);
      lines.push(
        `  ${chalk.cyan(type)} | ${String(m.queryCount).padStart(5)} | ${fmt(m.precisionAt5)} | ${fmt(m.precisionAt10)} | ${fmt(m.recallAt10)} | ${fmt(m.mrr)} | ${fmt(m.ndcgAt10)}`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Format a unified summary combining IR metrics, grep comparison, and token efficiency.
 */
export function formatUnifiedSummary(
  irReport: BenchmarkReport,
  grepComparison: GrepComparisonReport | null,
  tokenReport: TokenEfficiencyReport | null,
): string {
  const sections: string[] = [];

  // Section 1: CodeRAG IR Metrics
  sections.push(formatColoredSummary(irReport));

  // Section 2: CodeRAG vs Grep comparison
  if (grepComparison) {
    const lines: string[] = [];
    lines.push('');
    lines.push(chalk.bold('CodeRAG vs Grep Comparison'));
    lines.push(chalk.dim('========================='));
    lines.push(chalk.dim('  Metric              | CodeRAG  | Grep     | Delta'));
    lines.push(chalk.dim('  --------------------|----------|----------|----------'));

    const meanFilesDelta = grepComparison.coderagMeanFiles - grepComparison.grepMeanFiles;
    lines.push(
      `  ${'Mean files found'.padEnd(19)} | ${fmtNum(grepComparison.coderagMeanFiles)} | ${fmtNum(grepComparison.grepMeanFiles)} | ${formatDelta(meanFilesDelta)}`,
    );

    const durationDelta = grepComparison.coderagMeanDurationMs - grepComparison.grepMeanDurationMs;
    lines.push(
      `  ${'Mean latency (ms)'.padEnd(19)} | ${fmtNum(grepComparison.coderagMeanDurationMs)} | ${fmtNum(grepComparison.grepMeanDurationMs)} | ${formatDelta(durationDelta)}`,
    );

    lines.push('');
    lines.push(`  Queries:        ${chalk.cyan(String(grepComparison.queryCount))}`);
    lines.push(`  CodeRAG-only:   ${chalk.green(String(grepComparison.coderagOnlyFiles))} unique files`);
    lines.push(`  Grep-only:      ${chalk.yellow(String(grepComparison.grepOnlyFiles))} unique files`);
    lines.push(`  Overlap:        ${chalk.cyan(String(grepComparison.overlapFiles))} shared files`);

    sections.push(lines.join('\n'));
  }

  // Section 3: Token efficiency
  if (tokenReport) {
    const lines: string[] = [];
    lines.push('');
    lines.push(chalk.bold('Token Budget vs Quality'));
    lines.push(chalk.dim('======================='));
    lines.push(chalk.dim('  Budget   | MRR    | R@10   | Noise  | Latency(ms)'));
    lines.push(chalk.dim('  ---------|--------|--------|--------|------------'));

    // Show topK strategy results (primary strategy)
    const topKMetrics = tokenReport.perBudget.filter((m) => m.strategy === 'topK');
    for (const m of topKMetrics) {
      lines.push(
        `  ${String(m.tokenBudget).padStart(7)} | ${colorMetric(m.meanMrr)} | ${colorMetric(m.meanRecallAt10)} | ${fmt(m.meanNoiseRatio)} | ${fmtNum(m.meanDurationMs)}`,
      );
    }

    // Show 90% quality threshold
    const analyses = tokenReport.efficiencyAnalysis;
    if (analyses.length > 0) {
      lines.push('');
      lines.push(chalk.dim('  90% Quality Threshold:'));
      for (const a of analyses) {
        const threshold = a.tokensFor90PctQuality !== null
          ? `${a.tokensFor90PctQuality} tokens`
          : chalk.dim('not reached');
        lines.push(
          `  ${chalk.cyan(a.strategy.padEnd(16))} → ${threshold}  (max MRR: ${fmt(a.maxMrr)}, max R@10: ${fmt(a.maxRecall)})`,
        );
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n');
}

function colorMetric(value: number): string {
  const formatted = value.toFixed(4).padStart(6);
  if (value >= 0.7) return chalk.green(formatted);
  if (value >= 0.4) return chalk.yellow(formatted);
  return chalk.red(formatted);
}

function fmt(value: number): string {
  return value.toFixed(4).padStart(6);
}

function fmtNum(value: number): string {
  return value.toFixed(1).padStart(8);
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  const text = `${sign}${delta.toFixed(1)}`;
  if (delta > 0) return chalk.yellow(text.padStart(8));
  if (delta < 0) return chalk.green(text.padStart(8));
  return chalk.dim(text.padStart(8));
}

/**
 * Run grep comparison for each query, comparing file-level results.
 */
async function runGrepComparison(
  queries: readonly { readonly query: string; readonly expectedChunkIds: readonly string[] }[],
  searchFn: (query: string) => Promise<readonly string[]>,
  scan: IndexScanResult,
  rootDir: string,
): Promise<GrepComparisonReport> {
  const perQuery: GrepQueryResult[] = [];
  const allCoderagFiles = new Set<string>();
  const allGrepFiles = new Set<string>();
  let totalCoderagDuration = 0;
  let totalGrepDuration = 0;

  for (const q of queries) {
    // CodeRAG search → chunk IDs → file paths
    const coderagStart = performance.now();
    const chunkIds = await searchFn(q.query);
    const coderagDurationMs = performance.now() - coderagStart;
    const coderagFiles = chunkIdsToFilePaths(chunkIds, scan.entityMap);

    // Grep search → file paths (relative to rootDir)
    const keywords = extractKeywords(q.query);
    if (!keywords) {
      perQuery.push({
        query: q.query,
        grepFiles: [],
        coderagFiles,
        grepDurationMs: 0,
        coderagDurationMs,
      });
      totalCoderagDuration += coderagDurationMs;
      continue;
    }

    const grepResult = await runGrepSearch(keywords, rootDir);
    const grepFiles = grepResult.filePaths.map((p) =>
      p.startsWith('/') ? relative(rootDir, p) : p,
    );

    for (const f of coderagFiles) allCoderagFiles.add(f);
    for (const f of grepFiles) allGrepFiles.add(f);

    totalCoderagDuration += coderagDurationMs;
    totalGrepDuration += grepResult.durationMs;

    perQuery.push({
      query: q.query,
      grepFiles,
      coderagFiles,
      grepDurationMs: grepResult.durationMs,
      coderagDurationMs,
    });
  }

  const overlapFiles = [...allCoderagFiles].filter((f) => allGrepFiles.has(f)).length;

  return {
    queryCount: queries.length,
    coderagMeanFiles: perQuery.reduce((s, q) => s + q.coderagFiles.length, 0) / (perQuery.length || 1),
    grepMeanFiles: perQuery.reduce((s, q) => s + q.grepFiles.length, 0) / (perQuery.length || 1),
    coderagOnlyFiles: allCoderagFiles.size - overlapFiles,
    grepOnlyFiles: allGrepFiles.size - overlapFiles,
    overlapFiles,
    coderagMeanDurationMs: totalCoderagDuration / (perQuery.length || 1),
    grepMeanDurationMs: totalGrepDuration / (perQuery.length || 1),
    perQuery,
  };
}

/**
 * Run token efficiency benchmark using the project's own generated queries.
 */
async function runTokenEfficiency(
  queries: readonly { readonly query: string; readonly expectedChunkIds: readonly string[] }[],
  searchFn: (query: string, topK: number) => Promise<readonly { chunkId: string; content: string }[]>,
  tokenBudgets: readonly number[],
): Promise<TokenEfficiencyReport> {
  // Build a StrategyFn that wraps hybridSearch with token budget truncation
  const topKStrategy: StrategyFn = async (query: string, tokenBudget: number) => {
    const start = performance.now();
    // Fetch more results than needed, then truncate by token budget
    const results = await searchFn(query, 50);
    const retrievedIds: string[] = [];
    let totalTokens = 0;
    let relevantTokens = 0;

    const expectedSet = new Set(
      queries.find((q) => q.query === query)?.expectedChunkIds ?? [],
    );

    for (const r of results) {
      const tokens = estimateTokenCount(r.content);
      if (totalTokens + tokens > tokenBudget && retrievedIds.length > 0) break;
      retrievedIds.push(r.chunkId);
      totalTokens += tokens;
      if (expectedSet.has(r.chunkId)) {
        relevantTokens += tokens;
      }
    }

    return {
      retrievedIds,
      totalTokens,
      relevantTokens,
      durationMs: performance.now() - start,
    };
  };

  const strategies: StrategyMap = new Map([['topK', topKStrategy]]);

  const dataset = {
    queries: queries.map((q) => ({
      query: q.query,
      expectedChunkIds: q.expectedChunkIds,
    })),
  };

  return runTokenBudgetBenchmark(dataset, strategies, {
    tokenBudgets,
    strategies: ['topK'],
    datasetName: 'auto-generated',
  });
}

export function registerBenchmarkCommand(program: Command): void {
  program
    .command('benchmark')
    .description('Auto-generate benchmarks from the index and evaluate search quality')
    .option('--queries <n>', 'Number of benchmark queries to generate', '100')
    .option('--output <path>', 'Save detailed JSON report to this path')
    .option('--top-k <n>', 'Number of search results per query', '10')
    .option('--seed <n>', 'Random seed for reproducible generation', '42')
    .option('--skip-grep', 'Skip grep baseline comparison')
    .option('--skip-tokens', 'Skip token efficiency analysis')
    .option('--token-budgets <list>', 'Comma-separated token budgets to evaluate', DEFAULT_TOKEN_BUDGETS.join(','))
    .action(async (options: {
      queries: string;
      output?: string;
      topK: string;
      seed: string;
      skipGrep?: boolean;
      skipTokens?: boolean;
      tokenBudgets: string;
    }) => {
      try {
        const rootDir = process.cwd();
        const queryCount = parseInt(options.queries, 10);
        const topK = parseInt(options.topK, 10);
        const seed = parseInt(options.seed, 10);

        if (isNaN(queryCount) || queryCount < 1) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('Invalid --queries value. Must be a positive integer.'));
          process.exit(1);
        }
        if (isNaN(topK) || topK < 1) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('Invalid --top-k value. Must be a positive integer.'));
          process.exit(1);
        }
        if (isNaN(seed)) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('Invalid --seed value. Must be an integer.'));
          process.exit(1);
        }

        const tokenBudgets = options.tokenBudgets
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0);

        if (tokenBudgets.length === 0) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('Invalid --token-budgets value. Must be comma-separated positive integers.'));
          process.exit(1);
        }

        // --- Initialize runtime ---
        // eslint-disable-next-line no-console
        console.log(chalk.dim('Initializing runtime...'));
        const runtimeResult = await createRuntime({ rootDir, searchOnly: true });
        if (runtimeResult.isErr()) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('Initialization failed.'), runtimeResult.error.message);
          process.exit(1);
        }
        const runtime = runtimeResult.value;

        // --- Scan index ---
        // eslint-disable-next-line no-console
        console.log(chalk.dim('Scanning index...'));
        const allRowsResult = await runtime.store.getAll();
        if (allRowsResult.isErr()) {
          runtime.close();
          // eslint-disable-next-line no-console
          console.error(chalk.red('Failed to scan index:'), allRowsResult.error.message);
          process.exit(1);
        }

        const rows = allRowsResult.value;
        if (rows.length === 0) {
          runtime.close();
          // eslint-disable-next-line no-console
          console.log(chalk.yellow('Index is empty. Run "coderag index" first.'));
          return;
        }

        const scanResult = parseIndexRows(rows);
        if (scanResult.isErr()) {
          runtime.close();
          // eslint-disable-next-line no-console
          console.error(chalk.red('Failed to parse index:'), scanResult.error.message);
          process.exit(1);
        }

        const scan = scanResult.value;
        // eslint-disable-next-line no-console
        console.log(chalk.dim(`Found ${scan.totalChunks} chunks in index.`));

        // --- Load dependency graph ---
        let edges: GraphEdge[] = [];
        const storagePath = resolve(rootDir, runtime.config.storage.path);
        const graphPath = join(storagePath, 'graph.json');
        try {
          const graphData = await readFile(graphPath, 'utf-8');
          const parsed: unknown = JSON.parse(graphData);
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            'edges' in parsed &&
            Array.isArray((parsed as Record<string, unknown>)['edges'])
          ) {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Runtime-checked graph JSON structure
            edges = (parsed as { edges: GraphEdge[] }).edges;
          }
        } catch {
          // No graph available, proceed with empty edges
          // eslint-disable-next-line no-console
          console.log(chalk.dim('No dependency graph found, skipping caller/import queries.'));
        }

        // --- Build relationship maps ---
        const callerMap = buildCallerMap(edges);
        const testMap = buildTestMap(scan.fileToChunkIds);

        // --- Generate queries ---
        // eslint-disable-next-line no-console
        console.log(chalk.dim(`Generating ${queryCount} benchmark queries...`));
        const queries = generateQueries(
          scan,
          edges,
          callerMap,
          testMap,
          { maxQueries: queryCount },
          seed,
        );

        if (queries.length === 0) {
          runtime.close();
          // eslint-disable-next-line no-console
          console.log(chalk.yellow('Could not generate any benchmark queries from this index.'));
          return;
        }

        // eslint-disable-next-line no-console
        console.log(chalk.dim(`Generated ${queries.length} queries. Running evaluation...`));

        // --- Run IR benchmark ---
        const searchFn = async (query: string): Promise<readonly string[]> => {
          const result = await runtime.hybridSearch.search(query, { topK });
          if (result.isErr()) return [];
          return result.value.map((r) => r.chunkId);
        };

        const reportResult = await runBenchmark(
          queries,
          searchFn,
          scan.totalChunks,
          (completed, total) => {
            if (completed % 10 === 0 || completed === total) {
              // eslint-disable-next-line no-console
              process.stdout.write(`\r${chalk.dim(`  Progress: ${completed}/${total}`)}`);
            }
          },
        );

        if (reportResult.isErr()) {
          runtime.close();
          // eslint-disable-next-line no-console
          console.error(chalk.red('\nBenchmark failed:'), reportResult.error.message);
          process.exit(1);
        }

        const report = reportResult.value;

        // --- Run grep comparison (unless skipped) ---
        let grepComparison: GrepComparisonReport | null = null;
        if (!options.skipGrep) {
          // eslint-disable-next-line no-console
          console.log(chalk.dim('\nRunning grep baseline comparison...'));
          grepComparison = await runGrepComparison(queries, searchFn, scan, rootDir);
        }

        // --- Run token efficiency (unless skipped) ---
        let tokenReport: TokenEfficiencyReport | null = null;
        if (!options.skipTokens) {
          // eslint-disable-next-line no-console
          console.log(chalk.dim('Running token efficiency analysis...'));
          const richSearchFn = async (query: string, topKOverride: number) => {
            const result = await runtime.hybridSearch.search(query, { topK: topKOverride });
            if (result.isErr()) return [];
            return result.value.map((r) => ({
              chunkId: r.chunkId,
              content: r.content ?? '',
            }));
          };
          tokenReport = await runTokenEfficiency(queries, richSearchFn, tokenBudgets);
        }

        runtime.close();

        // --- Print unified summary ---
        // eslint-disable-next-line no-console
        console.log('\n');
        // eslint-disable-next-line no-console
        console.log(formatUnifiedSummary(report, grepComparison, tokenReport));

        // --- Save JSON report ---
        if (options.output) {
          const outputPath = resolve(options.output);
          const jsonReport = JSON.stringify(
            {
              ir: report,
              ...(grepComparison ? { grepComparison } : {}),
              ...(tokenReport ? { tokenEfficiency: tokenReport } : {}),
            },
            null,
            2,
          );
          await writeFile(outputPath, jsonReport, 'utf-8');
          // eslint-disable-next-line no-console
          console.log('');
          // eslint-disable-next-line no-console
          console.log(chalk.green(`Detailed report saved to: ${outputPath}`));
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('Benchmark failed:'), message);
        process.exit(1);
      }
    });
}
