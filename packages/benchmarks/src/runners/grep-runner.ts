/**
 * Baseline grep runner for benchmark comparison.
 *
 * Runs `grep -rn` against a directory and returns file paths
 * ranked by occurrence count.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Maximum grep output to process (10MB). */
const MAX_BUFFER = 10 * 1024 * 1024;

export interface GrepResult {
  filePaths: string[];
  durationMs: number;
}

/**
 * Parse grep output lines into a map of file path to match count.
 * Grep output format: `file:line:content`
 */
export function parseGrepOutput(stdout: string): Map<string, number> {
  const counts = new Map<string, number>();

  if (!stdout.trim()) return counts;

  const lines = stdout.trim().split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const filePath = line.slice(0, colonIndex);
    if (!filePath) continue;

    counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
  }

  return counts;
}

/**
 * Rank file paths by match count (descending).
 */
export function rankByOccurrence(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([filePath]) => filePath);
}

/**
 * Run grep against a root directory and return ranked file paths.
 */
export async function runGrepSearch(
  query: string,
  rootDir: string,
): Promise<GrepResult> {
  const start = performance.now();

  try {
    const { stdout } = await execFileAsync(
      'grep',
      ['-rn', '--include=*.ts', '--include=*.js', query, rootDir],
      { maxBuffer: MAX_BUFFER },
    );

    const counts = parseGrepOutput(stdout);
    const filePaths = rankByOccurrence(counts);
    const durationMs = performance.now() - start;

    return { filePaths, durationMs };
  } catch (error: unknown) {
    // grep exits with code 1 when no matches found — that is not an error
    const execError = error as { code?: number; stdout?: string };
    if (execError.code === 1) {
      return { filePaths: [], durationMs: performance.now() - start };
    }
    throw error;
  }
}
