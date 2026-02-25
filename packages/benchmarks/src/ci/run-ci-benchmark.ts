/**
 * CI benchmark orchestrator.
 *
 * Generates a synthetic repo, creates a dataset with ground-truth queries,
 * runs a deterministic retrieval function against the dataset, computes
 * IR metrics, and compares against the stored baseline.
 *
 * Designed to run in CI without Ollama or any external services.
 * Uses a simple keyword-matching retrieval function that is deterministic
 * and fast (no embeddings needed).
 */

import { ok, err, type Result } from 'neverthrow';
import { generateRepo } from '../generator/repo-generator.js';
import { generateQueries } from '../generator/query-template-engine.js';
import { runMetrics, adaptLegacyDataset } from '../metrics/metrics-runner.js';
import type { RetrievalFn } from '../metrics/types.js';
import type { CIBenchmarkResult } from './types.js';
import type { RepoManifest, ManifestEntity } from '../generator/repo-generator.js';

/** Configuration for a CI benchmark run. */
export interface CIBenchmarkConfig {
  /** PRNG seed for deterministic generation. */
  readonly seed: number;
  /** Number of source files to generate. */
  readonly fileCount: number;
  /** Git commit SHA being benchmarked. */
  readonly commitSha: string;
  /** Git branch name. */
  readonly branch: string;
  /** Minimum queries to generate. */
  readonly minQueries: number;
}

/** Default configuration for CI benchmarks. */
export const DEFAULT_CI_CONFIG: CIBenchmarkConfig = {
  seed: 42,
  fileCount: 20,
  commitSha: 'unknown',
  branch: 'unknown',
  minQueries: 30,
};

/** Error types for CI benchmark orchestration. */
export type CIBenchmarkError =
  | { readonly kind: 'generation_error'; readonly message: string }
  | { readonly kind: 'metrics_error'; readonly message: string };

/**
 * Run the full CI benchmark pipeline.
 *
 * Steps:
 * 1. Generate a synthetic repo (deterministic via seed)
 * 2. Generate benchmark queries with ground-truth
 * 3. Build a keyword-matching retrieval index from the manifest
 * 4. Run metrics evaluation
 * 5. Return the CIBenchmarkResult
 *
 * No Ollama, no embeddings, no network access required.
 */
export async function runCIBenchmark(
  config: Partial<CIBenchmarkConfig> = {},
): Promise<Result<CIBenchmarkResult, CIBenchmarkError>> {
  const fullConfig = { ...DEFAULT_CI_CONFIG, ...config };
  const startTime = Date.now();

  try {
    // Step 1: Generate synthetic repo
    const repo = generateRepo({
      seed: fullConfig.seed,
      fileCount: fullConfig.fileCount,
      languages: ['typescript'],
      complexity: 'medium',
    });

    // Step 2: Generate benchmark queries
    const dataset = generateQueries(repo.manifest, {
      seed: fullConfig.seed,
      minQueries: fullConfig.minQueries,
      targetRepo: 'ci-synthetic-repo',
    });

    // Step 3: Build retrieval function from manifest
    const retrievalFn = buildManifestRetrievalFn(repo.manifest);

    // Step 4: Convert to generic dataset and run metrics
    const genericDataset = adaptLegacyDataset(dataset);
    const report = await runMetrics(genericDataset, retrievalFn, 'ci-benchmark');

    const durationMs = Date.now() - startTime;

    // Step 5: Build result
    const result: CIBenchmarkResult = {
      timestamp: new Date().toISOString(),
      commitSha: fullConfig.commitSha,
      branch: fullConfig.branch,
      seed: fullConfig.seed,
      queryCount: report.perQuery.length,
      durationMs,
      metrics: report.aggregate,
    };

    return ok(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err({ kind: 'generation_error', message });
  }
}

/**
 * Build a deterministic retrieval function from a repo manifest.
 *
 * For each query, this function searches through the manifest entities
 * and scores them based on keyword matching against entity names,
 * descriptions, file paths, and module names.
 *
 * This produces a ranked list of chunk IDs that can be evaluated
 * against the ground truth expected chunk IDs.
 */
export function buildManifestRetrievalFn(
  manifest: RepoManifest,
): RetrievalFn {
  return async (query: string): Promise<readonly string[]> => {
    const queryLower = query.toLowerCase();
    const queryTokens = tokenize(queryLower);

    const scored: Array<{ id: string; score: number }> = [];

    for (const entity of manifest.entities) {
      const score = scoreEntity(entity, queryLower, queryTokens);
      if (score > 0) {
        scored.push({ id: entity.filePath, score });
      }
    }

    // Sort by score descending, then by ID for deterministic ordering
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    });

    // Deduplicate by file path (keep highest score)
    const seen = new Set<string>();
    const results: string[] = [];
    for (const item of scored) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        results.push(item.id);
      }
    }

    return results.slice(0, 20);
  };
}

/**
 * Score a manifest entity against a query using keyword matching.
 *
 * Higher scores indicate stronger matches. Scoring considers:
 * - Exact name match in query (highest weight)
 * - Token overlap between query and entity name/description
 * - Module name match
 * - File path token overlap
 */
export function scoreEntity(
  entity: ManifestEntity,
  queryLower: string,
  queryTokens: readonly string[],
): number {
  let score = 0;

  const nameLower = entity.name.toLowerCase();
  const descLower = entity.description.toLowerCase();
  const moduleLower = entity.module.toLowerCase();
  const pathLower = entity.filePath.toLowerCase();

  // Exact name match in query (strongest signal)
  if (queryLower.includes(nameLower) && nameLower.length > 2) {
    score += 10;
  }

  // For class.method names, check the method part too
  if (nameLower.includes('.')) {
    const parts = nameLower.split('.');
    for (const part of parts) {
      if (part && part.length > 2 && queryLower.includes(part)) {
        score += 7;
      }
    }
  }

  // Module name match
  if (queryLower.includes(moduleLower)) {
    score += 3;
  }

  // Token overlap with entity name
  const nameTokens = tokenize(nameLower);
  for (const qt of queryTokens) {
    for (const nt of nameTokens) {
      if (qt === nt && qt.length > 2) {
        score += 5;
      } else if (nt.includes(qt) && qt.length > 3) {
        score += 2;
      } else if (qt.includes(nt) && nt.length > 3) {
        score += 2;
      }
    }
  }

  // Token overlap with description
  const descTokens = tokenize(descLower);
  for (const qt of queryTokens) {
    for (const dt of descTokens) {
      if (qt === dt && qt.length > 3) {
        score += 1;
      }
    }
  }

  // Path token overlap
  const pathTokens = tokenize(pathLower);
  for (const qt of queryTokens) {
    for (const pt of pathTokens) {
      if (qt === pt && qt.length > 3) {
        score += 1;
      }
    }
  }

  return score;
}

/**
 * Tokenize a string into lowercase words.
 *
 * Handles camelCase, PascalCase, snake_case, kebab-case, and path separators.
 */
export function tokenize(text: string): readonly string[] {
  // Split on non-alphanumeric chars, then split camelCase
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Run a quick benchmark validation (for testing purposes).
 *
 * Uses a tiny repo to verify the pipeline works end-to-end.
 */
export async function runQuickValidation(): Promise<Result<CIBenchmarkResult, CIBenchmarkError>> {
  return runCIBenchmark({
    seed: 1,
    fileCount: 10,
    commitSha: 'validation',
    branch: 'test',
    minQueries: 10,
  });
}
