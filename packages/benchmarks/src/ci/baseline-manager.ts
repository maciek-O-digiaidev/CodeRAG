/**
 * Baseline manager for CI benchmark regression detection.
 *
 * Handles loading, saving, and validating baseline JSON files that store
 * the expected metric values. The baseline is committed to the repository
 * and auto-updated when benchmarks pass on the main branch.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import type { AggregateMetrics } from '../metrics/types.js';
import type { BaselineData, CIBenchmarkResult, HistoryEntry } from './types.js';

/** Error types for baseline operations. */
export type BaselineError =
  | { readonly kind: 'not_found'; readonly path: string }
  | { readonly kind: 'parse_error'; readonly message: string }
  | { readonly kind: 'write_error'; readonly message: string };

/** JSON formatting indentation. */
const JSON_INDENT = 2;

/**
 * Load a baseline from a JSON file.
 *
 * Returns an error if the file does not exist or cannot be parsed.
 */
export async function loadBaseline(
  filePath: string,
): Promise<Result<BaselineData, BaselineError>> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (!isBaselineData(parsed)) {
      return err({
        kind: 'parse_error',
        message: 'Baseline JSON does not match expected schema',
      });
    }

    return ok(parsed);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return err({ kind: 'not_found', path: filePath });
    }
    const message = error instanceof Error ? error.message : String(error);
    return err({ kind: 'parse_error', message });
  }
}

/**
 * Save a baseline to a JSON file.
 *
 * Creates parent directories if they do not exist.
 */
export async function saveBaseline(
  filePath: string,
  baseline: BaselineData,
): Promise<Result<void, BaselineError>> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(baseline, null, JSON_INDENT) + '\n', 'utf-8');
    return ok(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err({ kind: 'write_error', message });
  }
}

/**
 * Create a BaselineData from a CI benchmark result.
 */
export function createBaseline(result: CIBenchmarkResult): BaselineData {
  return {
    timestamp: result.timestamp,
    commitSha: result.commitSha,
    seed: result.seed,
    queryCount: result.queryCount,
    metrics: result.metrics,
  };
}

/**
 * Append a history entry to the history JSON file.
 *
 * If the file does not exist, creates a new one. Creates parent
 * directories as needed.
 */
export async function appendHistory(
  filePath: string,
  entry: HistoryEntry,
): Promise<Result<void, BaselineError>> {
  try {
    await mkdir(dirname(filePath), { recursive: true });

    let entries: HistoryEntry[] = [];
    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) {
        entries = parsed as HistoryEntry[];
      }
    } catch {
      // File doesn't exist yet — start fresh
    }

    entries.push(entry);
    await writeFile(filePath, JSON.stringify(entries, null, JSON_INDENT) + '\n', 'utf-8');
    return ok(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return err({ kind: 'write_error', message });
  }
}

/**
 * Convert a CIBenchmarkResult into a HistoryEntry.
 */
export function toHistoryEntry(result: CIBenchmarkResult): HistoryEntry {
  return {
    timestamp: result.timestamp,
    commitSha: result.commitSha,
    branch: result.branch,
    metrics: result.metrics,
    durationMs: result.durationMs,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isBaselineData(value: unknown): value is BaselineData {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;
  return (
    typeof obj['timestamp'] === 'string' &&
    typeof obj['commitSha'] === 'string' &&
    typeof obj['seed'] === 'number' &&
    typeof obj['queryCount'] === 'number' &&
    typeof obj['metrics'] === 'object' &&
    obj['metrics'] !== null &&
    isAggregateMetricsShape(obj['metrics'])
  );
}

function isAggregateMetricsShape(value: unknown): value is AggregateMetrics {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;
  return (
    typeof obj['precisionAt5'] === 'number' &&
    typeof obj['precisionAt10'] === 'number' &&
    typeof obj['recallAt5'] === 'number' &&
    typeof obj['recallAt10'] === 'number' &&
    typeof obj['mrr'] === 'number' &&
    typeof obj['ndcgAt10'] === 'number' &&
    typeof obj['map'] === 'number' &&
    typeof obj['contextPrecision'] === 'number'
  );
}
