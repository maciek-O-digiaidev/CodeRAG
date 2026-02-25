/**
 * Portable metrics runner that orchestrates dataset evaluation.
 *
 * Accepts any dataset conforming to GenericBenchmarkDataset, runs a
 * retrieval function for each query, and computes all IR + RAGAS metrics.
 *
 * Works with:
 * - Synthetic datasets from Tier 1 generators
 * - Adapted external datasets (Tier 2)
 * - The existing coderag-queries.json (backwards compatible via adapter)
 */

import {
  precisionAtK,
  recallAtK,
  mrr,
  ndcgAtK,
  averagePrecision,
  contextPrecision,
  contextRecall,
} from './ir-metrics.js';
import type {
  GenericBenchmarkDataset,
  GenericBenchmarkQuery,
  QueryMetricsResult,
  SingleQueryMetrics,
  AggregateMetrics,
  MetricsReport,
  RetrievalFn,
} from './types.js';
import type {
  BenchmarkDataset as LegacyDataset,
  BenchmarkQuery as LegacyQuery,
} from '../types.js';

/**
 * Compute all metrics for a single query result.
 */
export function computeSingleQueryMetrics(
  retrievedIds: readonly string[],
  expectedChunkIds: readonly string[],
  queryContext?: string,
): SingleQueryMetrics {
  const relevantSet = new Set(expectedChunkIds);

  return {
    precisionAt5: precisionAtK(retrievedIds, relevantSet, 5),
    precisionAt10: precisionAtK(retrievedIds, relevantSet, 10),
    recallAt5: recallAtK(retrievedIds, relevantSet, 5),
    recallAt10: recallAtK(retrievedIds, relevantSet, 10),
    mrr: mrr(retrievedIds, relevantSet),
    ndcgAt10: ndcgAtK(retrievedIds, relevantSet, 10),
    map: averagePrecision(retrievedIds, relevantSet),
    contextPrecision: contextPrecision(retrievedIds, relevantSet),
    contextRecall: queryContext !== undefined
      ? contextRecall(expectedChunkIds, queryContext)
      : null,
  };
}

/**
 * Compute aggregate metrics by averaging per-query metrics.
 *
 * For context_recall, only queries where the value is not null are averaged.
 * If no queries have context_recall, the aggregate is null.
 */
export function computeAggregateMetrics(
  results: readonly QueryMetricsResult[],
): AggregateMetrics {
  if (results.length === 0) {
    return {
      precisionAt5: 0,
      precisionAt10: 0,
      recallAt5: 0,
      recallAt10: 0,
      mrr: 0,
      ndcgAt10: 0,
      map: 0,
      contextPrecision: 0,
      contextRecall: null,
    };
  }

  const count = results.length;
  let sumP5 = 0;
  let sumP10 = 0;
  let sumR5 = 0;
  let sumR10 = 0;
  let sumMrr = 0;
  let sumNdcg = 0;
  let sumMap = 0;
  let sumCtxPrec = 0;
  let sumCtxRecall = 0;
  let ctxRecallCount = 0;

  for (const result of results) {
    const m = result.metrics;
    sumP5 += m.precisionAt5;
    sumP10 += m.precisionAt10;
    sumR5 += m.recallAt5;
    sumR10 += m.recallAt10;
    sumMrr += m.mrr;
    sumNdcg += m.ndcgAt10;
    sumMap += m.map;
    sumCtxPrec += m.contextPrecision;
    if (m.contextRecall !== null) {
      sumCtxRecall += m.contextRecall;
      ctxRecallCount++;
    }
  }

  return {
    precisionAt5: sumP5 / count,
    precisionAt10: sumP10 / count,
    recallAt5: sumR5 / count,
    recallAt10: sumR10 / count,
    mrr: sumMrr / count,
    ndcgAt10: sumNdcg / count,
    map: sumMap / count,
    contextPrecision: sumCtxPrec / count,
    contextRecall: ctxRecallCount > 0 ? sumCtxRecall / ctxRecallCount : null,
  };
}

/**
 * Run the metrics runner against a dataset.
 *
 * For each query in the dataset, calls the retrieval function and computes
 * all IR metrics against the expected chunk IDs.
 */
export async function runMetrics(
  dataset: GenericBenchmarkDataset,
  retrievalFn: RetrievalFn,
  datasetName: string = 'unnamed',
): Promise<MetricsReport> {
  const perQuery: QueryMetricsResult[] = [];

  for (const query of dataset.queries) {
    const retrievedIds = await retrievalFn(query.query);
    const metrics = computeSingleQueryMetrics(
      retrievedIds,
      query.expectedChunkIds,
      query.context,
    );

    perQuery.push({
      query: query.query,
      retrievedIds,
      expectedIds: query.expectedChunkIds,
      metrics,
    });
  }

  const aggregate = computeAggregateMetrics(perQuery);

  return {
    perQuery,
    aggregate,
    metadata: {
      datasetName,
      timestamp: new Date().toISOString(),
      queryCount: perQuery.length,
    },
  };
}

/**
 * Adapt a legacy BenchmarkDataset (coderag-queries.json) to the generic format.
 *
 * Maps expectedChunks[].filePath to expectedChunkIds, preserving backwards
 * compatibility with the existing dataset schema.
 */
export function adaptLegacyDataset(
  legacy: LegacyDataset,
): GenericBenchmarkDataset {
  const queries: GenericBenchmarkQuery[] = legacy.queries.map(
    (q: LegacyQuery) => ({
      query: q.query,
      expectedChunkIds: q.expectedChunks.map((chunk) => chunk.filePath),
    }),
  );

  return {
    queries,
    metadata: {
      name: legacy.name,
      description: legacy.description,
      targetRepo: legacy.targetRepo,
      adaptedFromLegacy: true,
    },
  };
}
