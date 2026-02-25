/**
 * One-off script to generate the initial baseline.json file.
 *
 * Run with: npx tsx packages/benchmarks/src/ci/generate-baseline.ts
 */

import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCIBenchmark } from './run-ci-benchmark.js';
import { createBaseline } from './baseline-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  console.log('Running CI benchmark to generate baseline...');

  const result = await runCIBenchmark({
    seed: 42,
    fileCount: 20,
    commitSha: 'initial',
    branch: 'main',
    minQueries: 30,
  });

  if (result.isErr()) {
    console.error('Benchmark failed:', result.error);
    process.exit(1);
  }

  const baseline = createBaseline(result.value);
  const baselinePath = resolve(__dirname, '../../results/baseline.json');

  await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
  console.log(`Baseline written to: ${baselinePath}`);
  console.log(`Metrics:`, JSON.stringify(baseline.metrics, null, 2));
  console.log(`Query count: ${baseline.queryCount}`);
}

main().catch(console.error);
