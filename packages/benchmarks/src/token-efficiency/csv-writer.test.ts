import { describe, it, expect } from 'vitest';
import {
  writeBudgetMetricsCsv,
  writeEfficiencyAnalysisCsv,
  writeQualityCurveCsv,
  writeFullReportCsv,
} from './csv-writer.js';
import type {
  BudgetLevelMetrics,
  EfficiencyAnalysis,
  TokenEfficiencyReport,
} from './types.js';

/** Helper to create a BudgetLevelMetrics. */
function makeBudgetMetrics(
  budget: number,
  strategy: BudgetLevelMetrics['strategy'],
): BudgetLevelMetrics {
  return {
    tokenBudget: budget,
    strategy,
    queryCount: 5,
    meanPrecisionAt5: 0.6,
    meanPrecisionAt10: 0.4,
    meanRecallAt5: 0.5,
    meanRecallAt10: 0.7,
    meanMrr: 0.8,
    meanNdcgAt10: 0.75,
    meanNoiseRatio: 0.3,
    meanTotalTokens: 900,
    meanDurationMs: 50,
  };
}

describe('writeBudgetMetricsCsv', () => {
  it('should write header row', () => {
    const csv = writeBudgetMetricsCsv([]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'budget,strategy,precision_at_5,precision_at_10,recall_at_5,recall_at_10,mrr,ndcg_at_10,noise_ratio,mean_tokens,mean_duration_ms',
    );
  });

  it('should write data rows with correct values', () => {
    const metrics = [makeBudgetMetrics(2000, 'topK')];
    const csv = writeBudgetMetricsCsv(metrics);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2); // header + 1 data row
    expect(lines[1]).toContain('2000');
    expect(lines[1]).toContain('topK');
    expect(lines[1]).toContain('0.6000');
    expect(lines[1]).toContain('0.8000');
    expect(lines[1]).toContain('0.3000');
  });

  it('should write multiple rows', () => {
    const metrics = [
      makeBudgetMetrics(1000, 'topK'),
      makeBudgetMetrics(2000, 'topK'),
      makeBudgetMetrics(1000, 'reranking'),
    ];
    const csv = writeBudgetMetricsCsv(metrics);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(4); // header + 3 data rows
  });

  it('should produce parseable CSV', () => {
    const metrics = [makeBudgetMetrics(4000, 'graphExpansion')];
    const csv = writeBudgetMetricsCsv(metrics);
    const lines = csv.split('\n');
    const header = lines[0]!.split(',');
    const values = lines[1]!.split(',');

    expect(header).toHaveLength(11);
    expect(values).toHaveLength(11);
  });
});

describe('writeEfficiencyAnalysisCsv', () => {
  it('should write header and data rows', () => {
    const analyses: EfficiencyAnalysis[] = [
      {
        strategy: 'topK',
        tokensFor90PctQuality: 4000,
        maxMrr: 0.9,
        maxRecall: 0.85,
        qualityCurve: [],
      },
    ];

    const csv = writeEfficiencyAnalysisCsv(analyses);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('strategy,tokens_for_90pct_quality,max_mrr,max_recall');
    expect(lines[1]).toBe('topK,4000,0.9000,0.8500');
  });

  it('should write N/A for null threshold', () => {
    const analyses: EfficiencyAnalysis[] = [
      {
        strategy: 'topK',
        tokensFor90PctQuality: null,
        maxMrr: 0.3,
        maxRecall: 0.2,
        qualityCurve: [],
      },
    ];

    const csv = writeEfficiencyAnalysisCsv(analyses);
    const lines = csv.split('\n');

    expect(lines[1]).toContain('N/A');
  });

  it('should handle empty array', () => {
    const csv = writeEfficiencyAnalysisCsv([]);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(1); // header only
  });
});

describe('writeQualityCurveCsv', () => {
  it('should write curve data', () => {
    const analysis: EfficiencyAnalysis = {
      strategy: 'budgetOptimized',
      tokensFor90PctQuality: 2000,
      maxMrr: 0.95,
      maxRecall: 0.9,
      qualityCurve: [
        { tokenBudget: 1000, normalizedQuality: 0.5, mrr: 0.475, recallAt10: 0.4, noiseRatio: 0.6 },
        { tokenBudget: 2000, normalizedQuality: 0.9, mrr: 0.855, recallAt10: 0.8, noiseRatio: 0.3 },
        { tokenBudget: 4000, normalizedQuality: 1.0, mrr: 0.95, recallAt10: 0.9, noiseRatio: 0.1 },
      ],
    };

    const csv = writeQualityCurveCsv(analysis);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('budget,normalized_quality,mrr,recall_at_10,noise_ratio');
    expect(lines).toHaveLength(4); // header + 3 data rows
    expect(lines[1]).toContain('1000');
    expect(lines[3]).toContain('4000');
  });

  it('should handle empty curve', () => {
    const analysis: EfficiencyAnalysis = {
      strategy: 'topK',
      tokensFor90PctQuality: null,
      maxMrr: 0,
      maxRecall: 0,
      qualityCurve: [],
    };

    const csv = writeQualityCurveCsv(analysis);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(1); // header only
  });
});

describe('writeFullReportCsv', () => {
  it('should produce same output as writeBudgetMetricsCsv with report.perBudget', () => {
    const perBudget = [
      makeBudgetMetrics(1000, 'topK'),
      makeBudgetMetrics(2000, 'reranking'),
    ];

    const report: TokenEfficiencyReport = {
      metadata: {
        datasetName: 'test',
        timestamp: '2026-01-01T00:00:00.000Z',
        tokenBudgets: [1000, 2000],
        strategies: ['topK', 'reranking'],
        queryCount: 5,
        qualityThreshold: 0.9,
      },
      perBudget,
      perQuery: [],
      efficiencyAnalysis: [],
    };

    const fullCsv = writeFullReportCsv(report);
    const directCsv = writeBudgetMetricsCsv(perBudget);

    expect(fullCsv).toBe(directCsv);
  });
});
