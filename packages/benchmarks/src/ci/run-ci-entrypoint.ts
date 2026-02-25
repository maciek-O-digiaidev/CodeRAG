/**
 * CLI entrypoint for CI benchmark execution.
 *
 * Parses command-line arguments, runs the benchmark, compares against
 * baseline, generates reports, and writes output files for the GitHub
 * Actions workflow to consume.
 *
 * Usage:
 *   node --import tsx packages/benchmarks/src/ci/run-ci-entrypoint.ts \
 *     --commit <sha> --branch <name> --baseline <path> \
 *     --history <dir> --output <path>
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCIBenchmark } from './run-ci-benchmark.js';
import { loadBaseline, createBaseline, saveBaseline, appendHistory, toHistoryEntry } from './baseline-manager.js';
import { detectRegressions } from './regression-detector.js';
import { formatPRComment, formatStatusLine } from './ci-reporter.js';

interface CliArgs {
  readonly commit: string;
  readonly branch: string;
  readonly baselinePath: string;
  readonly historyDir: string;
  readonly outputPath: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let commit = 'unknown';
  let branch = 'unknown';
  let baselinePath = 'packages/benchmarks/results/baseline.json';
  let historyDir = 'packages/benchmarks/results/history/';
  let outputPath = '/tmp/benchmark-report.json';

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--commit' && next) { commit = next; i++; }
    else if (arg === '--branch' && next) { branch = next; i++; }
    else if (arg === '--baseline' && next) { baselinePath = next; i++; }
    else if (arg === '--history' && next) { historyDir = next; i++; }
    else if (arg === '--output' && next) { outputPath = next; i++; }
  }

  return { commit, branch, baselinePath, historyDir, outputPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  console.log(`[benchmark] commit=${args.commit} branch=${args.branch}`);
  console.log(`[benchmark] baseline=${args.baselinePath}`);

  // Step 1: Run benchmark
  console.log('[benchmark] Running Tier 1 synthetic benchmark...');
  const benchmarkResult = await runCIBenchmark({
    seed: 42,
    fileCount: 20,
    commitSha: args.commit,
    branch: args.branch,
    minQueries: 30,
  });

  if (benchmarkResult.isErr()) {
    console.error('[benchmark] FAILED:', benchmarkResult.error);
    process.exit(1);
  }

  const result = benchmarkResult.value;
  console.log(`[benchmark] Completed: ${result.queryCount} queries in ${result.durationMs}ms`);

  // Step 2: Load baseline
  const baselineResult = await loadBaseline(args.baselinePath);
  const baseline = baselineResult.isOk() ? baselineResult.value : null;

  if (baseline === null) {
    console.log('[benchmark] No baseline found, this will become the first baseline');
  } else {
    console.log(`[benchmark] Baseline loaded: commit=${baseline.commitSha}`);
  }

  // Step 3: Detect regressions
  const report = detectRegressions(result, baseline);
  const statusLine = formatStatusLine(report);
  console.log(`[benchmark] ${statusLine}`);

  // Step 4: Generate PR comment
  const comment = formatPRComment(report);

  // Step 5: Write output report for GitHub Actions
  const outputReport = {
    hasRegression: report.hasRegression,
    statusLine,
    comment,
    metrics: result.metrics,
    durationMs: result.durationMs,
    queryCount: result.queryCount,
  };
  await writeFile(args.outputPath, JSON.stringify(outputReport, null, 2) + '\n', 'utf-8');
  console.log(`[benchmark] Report written to ${args.outputPath}`);

  // Step 6: Write new baseline file (for main branch auto-update)
  const newBaseline = createBaseline(result);
  await saveBaseline('/tmp/benchmark-new-baseline.json', newBaseline);

  // Step 7: Append to history
  const historyFile = join(args.historyDir, 'benchmark-history.json');
  const historyEntry = toHistoryEntry(result);
  const historyResult = await appendHistory(historyFile, historyEntry);
  if (historyResult.isOk()) {
    console.log(`[benchmark] History appended to ${historyFile}`);
  }

  // Step 8: Exit with appropriate code
  if (report.hasRegression) {
    console.error('[benchmark] REGRESSION DETECTED - see report for details');
    // Don't exit(1) here - let the workflow handle the failure via the report
  }
}

main().catch((error: unknown) => {
  console.error('[benchmark] Unexpected error:', error);
  process.exit(1);
});
