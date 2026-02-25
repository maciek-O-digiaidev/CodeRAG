/**
 * JSON report writer for metrics runner output.
 *
 * Serializes a MetricsReport to a formatted JSON string suitable for
 * writing to disk or returning as an API response.
 */

import type { MetricsReport } from './types.js';

/** Indentation for JSON output. */
const JSON_INDENT = 2;

/**
 * Serialize a MetricsReport to a formatted JSON string.
 *
 * The output includes per-query results, aggregate metrics, and metadata.
 * All numeric values are preserved at full precision.
 */
export function writeJsonReport(report: MetricsReport): string {
  return JSON.stringify(report, null, JSON_INDENT);
}

/**
 * Generate a markdown summary table from a MetricsReport.
 *
 * Includes aggregate metrics in a single-row table and a summary of
 * per-query results for easy human review.
 */
export function writeMarkdownReport(report: MetricsReport): string {
  const lines: string[] = [];

  lines.push('# IR Metrics Report');
  lines.push('');
  lines.push(`**Dataset**: ${report.metadata.datasetName}`);
  lines.push(`**Date**: ${report.metadata.timestamp.split('T')[0] ?? report.metadata.timestamp}`);
  lines.push(`**Queries**: ${report.metadata.queryCount}`);
  lines.push('');

  // Aggregate metrics table
  lines.push('## Aggregate Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');

  const a = report.aggregate;
  lines.push(`| Precision@5 | ${fmt(a.precisionAt5)} |`);
  lines.push(`| Precision@10 | ${fmt(a.precisionAt10)} |`);
  lines.push(`| Recall@5 | ${fmt(a.recallAt5)} |`);
  lines.push(`| Recall@10 | ${fmt(a.recallAt10)} |`);
  lines.push(`| MRR | ${fmt(a.mrr)} |`);
  lines.push(`| nDCG@10 | ${fmt(a.ndcgAt10)} |`);
  lines.push(`| MAP | ${fmt(a.map)} |`);
  lines.push(`| Context Precision | ${fmt(a.contextPrecision)} |`);
  lines.push(
    `| Context Recall | ${a.contextRecall !== null ? fmt(a.contextRecall) : 'N/A'} |`,
  );
  lines.push('');

  // Per-query details
  if (report.perQuery.length > 0) {
    lines.push('## Per-Query Results');
    lines.push('');
    lines.push(
      '| Query | P@5 | R@5 | MRR | MAP | Ctx Precision |',
    );
    lines.push(
      '|-------|-----|-----|-----|-----|---------------|',
    );

    for (const q of report.perQuery) {
      const truncatedQuery =
        q.query.length > 50 ? q.query.slice(0, 47) + '...' : q.query;
      const m = q.metrics;
      lines.push(
        `| ${truncatedQuery} | ${fmt(m.precisionAt5)} | ${fmt(m.recallAt5)} | ${fmt(m.mrr)} | ${fmt(m.map)} | ${fmt(m.contextPrecision)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function fmt(value: number): string {
  return value.toFixed(4);
}
