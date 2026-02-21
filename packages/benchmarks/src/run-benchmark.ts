/**
 * CLI entry point for running benchmarks.
 *
 * Usage: node --import tsx src/run-benchmark.ts [dataset-path]
 */

import { resolve, dirname } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runBenchmark, generateMarkdownReport } from './benchmark.js';
import { runGrepSearch } from './runners/grep-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const datasetPath =
    process.argv[2] ?? resolve(__dirname, '../datasets/coderag-queries.json');
  const rootDir = resolve(__dirname, '../../..');

  console.log(`Running benchmark with dataset: ${datasetPath}`);
  console.log(`Root directory: ${rootDir}`);
  console.log('');

  // Run grep baseline
  console.log('Running grep baseline...');
  const grepReport = await runBenchmark(datasetPath, 'grep', async (query) => {
    return runGrepSearch(query, rootDir);
  });

  console.log(`Grep baseline completed: ${grepReport.totalQueries} queries`);
  console.log('');

  // Generate reports
  const markdownReport = generateMarkdownReport([grepReport]);
  console.log(markdownReport);

  // Write JSON report
  const resultsDir = resolve(__dirname, '../results');
  await mkdir(resultsDir, { recursive: true });

  const jsonReportPath = resolve(resultsDir, 'benchmark-report.json');
  try {
    await writeFile(jsonReportPath, JSON.stringify(grepReport, null, 2));
    console.log(`JSON report written to: ${jsonReportPath}`);
  } catch (error) {
    console.error('Failed to write JSON report:', error);
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
