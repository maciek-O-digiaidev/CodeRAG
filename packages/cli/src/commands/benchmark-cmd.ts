/**
 * CLI command: coderag benchmark
 *
 * Auto-generates a benchmark dataset from an indexed project and evaluates
 * CodeRAG search quality against it. Prints a summary table and optionally
 * saves a detailed JSON report.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  createRuntime,
  parseIndexRows,
  buildCallerMap,
  buildTestMap,
  generateQueries,
  runBenchmark,
} from '@code-rag/core';
import type { GraphEdge, BenchmarkReport } from '@code-rag/core';

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

function colorMetric(value: number): string {
  const formatted = value.toFixed(4).padStart(6);
  if (value >= 0.7) return chalk.green(formatted);
  if (value >= 0.4) return chalk.yellow(formatted);
  return chalk.red(formatted);
}

function fmt(value: number): string {
  return value.toFixed(4).padStart(6);
}

export function registerBenchmarkCommand(program: Command): void {
  program
    .command('benchmark')
    .description('Auto-generate benchmarks from the index and evaluate search quality')
    .option('--queries <n>', 'Number of benchmark queries to generate', '100')
    .option('--output <path>', 'Save detailed JSON report to this path')
    .option('--top-k <n>', 'Number of search results per query', '10')
    .option('--seed <n>', 'Random seed for reproducible generation', '42')
    .action(async (options: {
      queries: string;
      output?: string;
      topK: string;
      seed: string;
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

        // --- Run benchmark ---
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

        runtime.close();

        if (reportResult.isErr()) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('\nBenchmark failed:'), reportResult.error.message);
          process.exit(1);
        }

        const report = reportResult.value;

        // --- Print summary ---
        // eslint-disable-next-line no-console
        console.log('\n');
        // eslint-disable-next-line no-console
        console.log(formatColoredSummary(report));

        // --- Save JSON report ---
        if (options.output) {
          const outputPath = resolve(options.output);
          const jsonReport = JSON.stringify(report, null, 2);
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
