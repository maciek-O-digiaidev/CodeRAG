---
tags:
  - package
  - benchmarks
  - quality
  - metrics
aliases:
  - "@code-rag/benchmarks"
  - benchmarks-package
  - search-quality
---

# @code-rag/benchmarks

A benchmark suite for measuring CodeRAG search quality against a grep baseline. Uses curated query datasets with expected results and computes standard information retrieval metrics.

**Package**: `@code-rag/benchmarks` (private)
**Dependencies**: `@code-rag/core`
**Dev dependencies**: `tsx`, `vitest`

## Purpose

The benchmark package answers the question: *How much better is CodeRAG's hybrid semantic search compared to simple text grep?*

It loads a dataset of curated queries with known relevant files, runs each query through different search runners, computes IR metrics, and generates a comparison report.

## Metrics

All metrics are implemented as pure functions in `metrics.ts`:

| Metric | Function | Description |
|--------|----------|-------------|
| Precision@K | `precisionAtK(retrieved, relevant, k)` | Fraction of top-K results that are relevant |
| Recall@K | `recallAtK(retrieved, relevant, k)` | Fraction of relevant items found in top-K |
| MRR | `meanReciprocalRank(retrieved, relevant)` | 1 / rank of the first relevant result |
| nDCG@K | `ndcg(retrieved, relevant, k)` | Normalized Discounted Cumulative Gain (binary relevance) |

Metrics are computed at K=5 and K=10 for precision and recall.

> **Note: > Precision@K uses the standard IR definition where the denominator is always K, penalizing runners that return fewer than K results.**

## Dataset Schema

Benchmark datasets are JSON files following this schema:

```typescript
interface BenchmarkDataset {
  name: string;                  // e.g., "coderag-self-benchmark"
  description: string;
  targetRepo: string;            // Path to the repo under test
  queries: BenchmarkQuery[];
}

interface BenchmarkQuery {
  id: string;                    // Unique query identifier
  query: string;                 // Natural language query text
  difficulty: 'easy' | 'medium' | 'hard';
  category: 'function_lookup' | 'concept_search' | 'cross_file' | 'error_investigation';
  expectedChunks: ExpectedChunk[];
  tags: string[];
}

interface ExpectedChunk {
  filePath: string;              // e.g., "packages/core/src/embedding/hybrid-search.ts"
  chunkType: string;             // e.g., "function", "class", "method"
  name: string;                  // e.g., "HybridSearch"
  relevance: 'primary' | 'secondary';
}
```

Datasets are stored in the `datasets/` directory (e.g., `datasets/coderag-queries.json`).

## Runners

### CodeRAG Runner (`runners/coderag-runner.ts`)

Uses `HybridSearch` from `@code-rag/core` to run queries:

- Accepts a pre-configured `HybridSearch` instance
- Runs the query with configurable `topK`
- Deduplicates file paths from results while preserving rank order
- Returns file paths, full `SearchResult[]`, and duration in milliseconds

### Grep Runner (`runners/grep-runner.ts`)

Baseline comparison using system `grep`:

- Executes `grep -rn --include=*.ts --include=*.js <query> <rootDir>`
- Parses output to count matches per file
- Ranks files by occurrence count (descending)
- Handles `grep` exit code 1 (no matches) gracefully
- 10 MB output buffer limit

## BenchmarkRunner

The `runBenchmark()` function orchestrates a complete benchmark run:

```typescript
const report = await runBenchmark(
  'datasets/coderag-queries.json',  // dataset path
  'coderag',                        // runner name
  runnerFn,                         // (query: string) => { filePaths, durationMs }
);
```

Steps:

1. Load the dataset from JSON
2. For each query, extract relevant file paths from expected chunks
3. Run the query through the runner function
4. Compute per-query metrics (P@5, P@10, R@5, R@10, MRR, nDCG@10)
5. Compute aggregate metrics by averaging across all queries
6. Return a `BenchmarkReport` with all results

## Performance Measurement

The `perf/` directory provides utilities for measuring runtime and resource usage:

| Function | Description |
|----------|-------------|
| `measureTime(fn)` | Wraps an async function, returns `{ result, durationMs }` |
| `measureMemory()` | Captures current heap and RSS usage in megabytes |
| `computePercentiles(values, [50, 95, 99])` | Computes percentile values from an array of measurements |

## Running Benchmarks

```bash
# Run with default dataset
pnpm --filter @code-rag/benchmarks benchmark

# Run with a custom dataset
node --import tsx packages/benchmarks/src/run-benchmark.ts path/to/dataset.json
```

The CLI entry point (`run-benchmark.ts`) runs the grep baseline, generates a markdown comparison table, and writes a JSON report to `results/benchmark-report.json`.

### Report Output

The `generateMarkdownReport()` function produces a comparison table:

```markdown
# Benchmark Results

Date: 2026-02-23

## Aggregate Metrics

| Runner | P@5 | P@10 | R@5 | R@10 | MRR | nDCG@10 | Queries |
|--------|-----|------|-----|------|-----|---------|---------|
| grep   | 0.2000 | 0.1500 | 0.3000 | 0.4500 | 0.5000 | 0.4200 | 20 |
| coderag | 0.6000 | 0.5000 | 0.7500 | 0.9000 | 0.8500 | 0.7800 | 20 |
```

## See Also

- [Hybrid Search](../architecture/hybrid-search.md) -- the search algorithm being benchmarked
- [Core](core.md) -- the core library providing search functionality
