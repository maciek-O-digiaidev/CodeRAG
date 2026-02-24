/**
 * CLI entry point for running benchmarks.
 *
 * Usage: node --import tsx src/run-benchmark.ts [dataset-path]
 */

import { resolve, dirname, relative } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runBenchmark, generateMarkdownReport } from './benchmark.js';
import { runGrepSearch } from './runners/grep-runner.js';
import { runCodeRAGSearch } from './runners/coderag-runner.js';
import {
  loadConfig,
  LanceDBStore,
  BM25Index,
  HybridSearch,
  OllamaEmbeddingProvider,
} from '@code-rag/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract keywords from a natural language query for grep.
 * Removes stop words and short words to get meaningful search terms.
 */
function extractKeywords(query: string): string {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'must',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
    'it', 'its', 'this', 'that', 'these', 'those',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
    'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
    'find', 'show', 'get', 'list', 'display', 'where', 'defined',
    'work', 'works', 'working', 'used', 'using', 'use',
    'does', 'happen', 'happens', 'between', 'each', 'other',
  ]);

  const words = query
    .replace(/[?.,!]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()));

  // If we have PascalCase/camelCase identifiers, prefer those
  const identifiers = words.filter((w) => /[A-Z]/.test(w));
  if (identifiers.length > 0) {
    return identifiers.join('\\|');
  }

  // Otherwise join top keywords with grep OR
  return words.slice(0, 3).join('\\|');
}

async function main(): Promise<void> {
  const datasetPath =
    process.argv[2] ?? resolve(__dirname, '../datasets/coderag-queries.json');
  const rootDir = resolve(__dirname, '../../..');

  console.log(`Running benchmark with dataset: ${datasetPath}`);
  console.log(`Root directory: ${rootDir}`);
  console.log('');

  /** Normalize absolute paths to relative (from rootDir), filter out worktrees. */
  function normalizePaths(filePaths: string[]): string[] {
    return filePaths
      .filter((p) => !p.includes('.claude/worktrees'))
      .map((p) => (p.startsWith('/') ? relative(rootDir, p) : p));
  }

  // Run grep baseline with keyword extraction
  console.log('Running grep baseline...');
  const grepReport = await runBenchmark(datasetPath, 'grep', async (query) => {
    const keywords = extractKeywords(query);
    const result = await runGrepSearch(keywords, rootDir);
    return { filePaths: normalizePaths(result.filePaths), durationMs: result.durationMs };
  });
  console.log(`Grep baseline completed: ${grepReport.totalQueries} queries`);
  console.log('');

  // Run CodeRAG hybrid search
  console.log('Running CodeRAG hybrid search...');
  const configResult = await loadConfig(rootDir);
  if (configResult.isErr()) {
    console.error('Failed to load config:', configResult.error);
    process.exit(1);
  }

  const config = configResult.value;
  const embeddingProvider = new OllamaEmbeddingProvider({
    model: config.embedding?.model ?? 'nomic-embed-text',
    baseUrl: 'http://localhost:11434',
  });
  const storageDir = resolve(rootDir, config.storage?.path ?? '.coderag');
  const dimensions = config.embedding?.dimensions ?? 768;
  const vectorStore = new LanceDBStore(resolve(storageDir, 'lancedb'), dimensions);
  // Load BM25 from disk
  const { readFile } = await import('node:fs/promises');
  const bm25Path = resolve(storageDir, 'bm25-index.json');
  const bm25Json = await readFile(bm25Path, 'utf-8');
  const bm25 = BM25Index.deserialize(bm25Json);

  const searchConfig = {
    topK: config.search?.topK ?? 10,
    vectorWeight: config.search?.vectorWeight ?? 0.7,
    bm25Weight: config.search?.bm25Weight ?? 0.3,
  };
  const hybridSearch = new HybridSearch(vectorStore, bm25, embeddingProvider, searchConfig);

  const coderagReport = await runBenchmark(
    datasetPath,
    'coderag',
    async (query) => {
      const result = await runCodeRAGSearch(query, hybridSearch);
      return { filePaths: normalizePaths(result.filePaths), durationMs: result.durationMs };
    },
  );
  console.log(
    `CodeRAG completed: ${coderagReport.totalQueries} queries`,
  );
  console.log('');

  // Generate reports
  const markdownReport = generateMarkdownReport([grepReport, coderagReport]);
  console.log(markdownReport);

  // Write JSON report
  const resultsDir = resolve(__dirname, '../results');
  await mkdir(resultsDir, { recursive: true });

  const jsonReportPath = resolve(resultsDir, 'benchmark-report.json');
  try {
    await writeFile(
      jsonReportPath,
      JSON.stringify({ grep: grepReport, coderag: coderagReport }, null, 2),
    );
    console.log(`JSON report written to: ${jsonReportPath}`);
  } catch (error) {
    console.error('Failed to write JSON report:', error);
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
