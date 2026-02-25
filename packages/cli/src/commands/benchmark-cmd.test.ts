import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import {
  registerBenchmarkCommand,
  formatColoredSummary,
  formatUnifiedSummary,
  chunkIdsToFilePaths,
} from './benchmark-cmd.js';
import type { BenchmarkReport } from '@code-rag/core';
import type { GrepComparisonReport } from './benchmark-cmd.js';
import type { TokenEfficiencyReport } from '@code-rag/benchmarks';

const SAMPLE_REPORT: BenchmarkReport = {
  aggregate: {
    precisionAt5: 0.45,
    precisionAt10: 0.32,
    recallAt10: 0.78,
    mrr: 0.65,
    ndcgAt10: 0.58,
    queryCount: 50,
  },
  byQueryType: [
    {
      queryType: 'find-by-name',
      metrics: {
        precisionAt5: 0.6,
        precisionAt10: 0.4,
        recallAt10: 0.9,
        mrr: 0.8,
        ndcgAt10: 0.7,
        queryCount: 30,
      },
    },
    {
      queryType: 'find-by-description',
      metrics: {
        precisionAt5: 0.3,
        precisionAt10: 0.2,
        recallAt10: 0.6,
        mrr: 0.5,
        ndcgAt10: 0.4,
        queryCount: 20,
      },
    },
  ],
  perQuery: [],
  metadata: {
    timestamp: '2026-02-25T12:00:00.000Z',
    totalQueries: 50,
    totalChunksInIndex: 200,
    durationMs: 3210,
  },
};

const EMPTY_REPORT: BenchmarkReport = {
  aggregate: {
    precisionAt5: 0,
    precisionAt10: 0,
    recallAt10: 0,
    mrr: 0,
    ndcgAt10: 0,
    queryCount: 0,
  },
  byQueryType: [],
  perQuery: [],
  metadata: {
    timestamp: '2026-02-25T12:00:00.000Z',
    totalQueries: 0,
    totalChunksInIndex: 0,
    durationMs: 0,
  },
};

describe('registerBenchmarkCommand', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.name('coderag').version('0.1.0');
    registerBenchmarkCommand(program);
  });

  it('should register the benchmark command', () => {
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toContain('benchmark');
  });

  it('should have --queries option with default 100', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    const queriesOpt = benchmarkCmd!.options.find((o) => o.long === '--queries');
    expect(queriesOpt).toBeDefined();
    expect(queriesOpt!.defaultValue).toBe('100');
  });

  it('should have --output option', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    const outputOpt = benchmarkCmd!.options.find((o) => o.long === '--output');
    expect(outputOpt).toBeDefined();
  });

  it('should have --top-k option with default 10', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    const topKOpt = benchmarkCmd!.options.find((o) => o.long === '--top-k');
    expect(topKOpt).toBeDefined();
    expect(topKOpt!.defaultValue).toBe('10');
  });

  it('should have --seed option with default 42', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    const seedOpt = benchmarkCmd!.options.find((o) => o.long === '--seed');
    expect(seedOpt).toBeDefined();
    expect(seedOpt!.defaultValue).toBe('42');
  });

  it('should have --skip-grep flag', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    const opt = benchmarkCmd!.options.find((o) => o.long === '--skip-grep');
    expect(opt).toBeDefined();
  });

  it('should have --skip-tokens flag', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    const opt = benchmarkCmd!.options.find((o) => o.long === '--skip-tokens');
    expect(opt).toBeDefined();
  });

  it('should have --token-budgets option with default', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    const opt = benchmarkCmd!.options.find((o) => o.long === '--token-budgets');
    expect(opt).toBeDefined();
    expect(opt!.defaultValue).toBe('1000,2000,4000,8000,16000');
  });

  it('should have a description', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    expect(benchmarkCmd!.description()).toBeTruthy();
    expect(benchmarkCmd!.description()).toContain('benchmark');
  });
});

describe('formatColoredSummary', () => {
  it('should produce formatted output with all sections', () => {
    const output = formatColoredSummary(SAMPLE_REPORT);
    expect(output).toContain('Benchmark Results');
    expect(output).toContain('50');
    expect(output).toContain('200');
    expect(output).toContain('3.2');
    expect(output).toContain('P@5');
    expect(output).toContain('MRR');
    expect(output).toContain('nDCG@10');
    expect(output).toContain('By Query Type');
  });

  it('should handle empty query type breakdown', () => {
    const output = formatColoredSummary(EMPTY_REPORT);
    expect(output).toContain('Benchmark Results');
    expect(output).not.toContain('By Query Type');
  });
});

describe('formatUnifiedSummary', () => {
  it('should include only IR section when grep and tokens are null', () => {
    const output = formatUnifiedSummary(SAMPLE_REPORT, null, null);
    expect(output).toContain('Benchmark Results');
    expect(output).not.toContain('CodeRAG vs Grep');
    expect(output).not.toContain('Token Budget');
  });

  it('should include grep comparison section when provided', () => {
    const grepComparison: GrepComparisonReport = {
      queryCount: 50,
      coderagMeanFiles: 5.2,
      grepMeanFiles: 3.8,
      coderagOnlyFiles: 12,
      grepOnlyFiles: 8,
      overlapFiles: 15,
      coderagMeanDurationMs: 45.3,
      grepMeanDurationMs: 12.1,
      perQuery: [],
    };

    const output = formatUnifiedSummary(SAMPLE_REPORT, grepComparison, null);
    expect(output).toContain('Benchmark Results');
    expect(output).toContain('CodeRAG vs Grep');
    expect(output).toContain('Mean files found');
    expect(output).toContain('Mean latency');
    expect(output).toContain('CodeRAG-only');
    expect(output).toContain('Grep-only');
    expect(output).toContain('Overlap');
    expect(output).not.toContain('Token Budget');
  });

  it('should include token efficiency section when provided', () => {
    const tokenReport: TokenEfficiencyReport = {
      metadata: {
        datasetName: 'test',
        timestamp: '2026-02-25T12:00:00.000Z',
        tokenBudgets: [1000, 4000],
        strategies: ['topK'],
        queryCount: 10,
        qualityThreshold: 0.9,
      },
      perBudget: [
        {
          tokenBudget: 1000,
          strategy: 'topK',
          queryCount: 10,
          meanPrecisionAt5: 0.3,
          meanPrecisionAt10: 0.2,
          meanRecallAt5: 0.4,
          meanRecallAt10: 0.5,
          meanMrr: 0.45,
          meanNdcgAt10: 0.4,
          meanNoiseRatio: 0.6,
          meanDurationMs: 30,
          meanTotalTokens: 800,
        },
        {
          tokenBudget: 4000,
          strategy: 'topK',
          queryCount: 10,
          meanPrecisionAt5: 0.5,
          meanPrecisionAt10: 0.4,
          meanRecallAt5: 0.6,
          meanRecallAt10: 0.7,
          meanMrr: 0.65,
          meanNdcgAt10: 0.6,
          meanNoiseRatio: 0.4,
          meanDurationMs: 50,
          meanTotalTokens: 3200,
        },
      ],
      perQuery: [],
      efficiencyAnalysis: [
        {
          strategy: 'topK',
          tokensFor90PctQuality: 4000,
          maxMrr: 0.65,
          maxRecall: 0.7,
          qualityCurve: [
            { tokenBudget: 1000, normalizedQuality: 0.69, mrr: 0.45, recallAt10: 0.5, noiseRatio: 0.6 },
            { tokenBudget: 4000, normalizedQuality: 1.0, mrr: 0.65, recallAt10: 0.7, noiseRatio: 0.4 },
          ],
        },
      ],
    };

    const output = formatUnifiedSummary(SAMPLE_REPORT, null, tokenReport);
    expect(output).toContain('Benchmark Results');
    expect(output).toContain('Token Budget vs Quality');
    expect(output).toContain('1000');
    expect(output).toContain('4000');
    expect(output).toContain('90% Quality Threshold');
    expect(output).toContain('topK');
    expect(output).toContain('4000 tokens');
    expect(output).not.toContain('CodeRAG vs Grep');
  });

  it('should include all three sections when all data provided', () => {
    const grepComparison: GrepComparisonReport = {
      queryCount: 10,
      coderagMeanFiles: 5,
      grepMeanFiles: 3,
      coderagOnlyFiles: 4,
      grepOnlyFiles: 2,
      overlapFiles: 6,
      coderagMeanDurationMs: 40,
      grepMeanDurationMs: 10,
      perQuery: [],
    };
    const tokenReport: TokenEfficiencyReport = {
      metadata: {
        datasetName: 'test',
        timestamp: '2026-02-25T12:00:00.000Z',
        tokenBudgets: [2000],
        strategies: ['topK'],
        queryCount: 5,
        qualityThreshold: 0.9,
      },
      perBudget: [
        {
          tokenBudget: 2000,
          strategy: 'topK',
          queryCount: 5,
          meanPrecisionAt5: 0.4,
          meanPrecisionAt10: 0.3,
          meanRecallAt5: 0.5,
          meanRecallAt10: 0.6,
          meanMrr: 0.55,
          meanNdcgAt10: 0.5,
          meanNoiseRatio: 0.5,
          meanDurationMs: 35,
          meanTotalTokens: 1600,
        },
      ],
      perQuery: [],
      efficiencyAnalysis: [
        {
          strategy: 'topK',
          tokensFor90PctQuality: 2000,
          maxMrr: 0.55,
          maxRecall: 0.6,
          qualityCurve: [
            { tokenBudget: 2000, normalizedQuality: 1.0, mrr: 0.55, recallAt10: 0.6, noiseRatio: 0.5 },
          ],
        },
      ],
    };

    const output = formatUnifiedSummary(SAMPLE_REPORT, grepComparison, tokenReport);
    expect(output).toContain('Benchmark Results');
    expect(output).toContain('CodeRAG vs Grep');
    expect(output).toContain('Token Budget vs Quality');
  });

  it('should show "not reached" when threshold is null', () => {
    const tokenReport: TokenEfficiencyReport = {
      metadata: {
        datasetName: 'test',
        timestamp: '2026-02-25T12:00:00.000Z',
        tokenBudgets: [1000],
        strategies: ['topK'],
        queryCount: 5,
        qualityThreshold: 0.9,
      },
      perBudget: [],
      perQuery: [],
      efficiencyAnalysis: [
        {
          strategy: 'topK',
          tokensFor90PctQuality: null,
          maxMrr: 0.3,
          maxRecall: 0.2,
          qualityCurve: [],
        },
      ],
    };

    const output = formatUnifiedSummary(EMPTY_REPORT, null, tokenReport);
    expect(output).toContain('not reached');
  });
});

describe('chunkIdsToFilePaths', () => {
  it('should map chunk IDs to unique file paths', () => {
    const entityMap = new Map([
      ['chunk-1', { filePath: 'src/foo.ts' }],
      ['chunk-2', { filePath: 'src/bar.ts' }],
      ['chunk-3', { filePath: 'src/foo.ts' }],
    ]);

    const result = chunkIdsToFilePaths(['chunk-1', 'chunk-2', 'chunk-3'], entityMap);
    expect(result).toEqual(['src/bar.ts', 'src/foo.ts']);
  });

  it('should skip unknown chunk IDs', () => {
    const entityMap = new Map([
      ['chunk-1', { filePath: 'src/foo.ts' }],
    ]);

    const result = chunkIdsToFilePaths(['chunk-1', 'chunk-unknown'], entityMap);
    expect(result).toEqual(['src/foo.ts']);
  });

  it('should return empty array for empty input', () => {
    const entityMap = new Map<string, { filePath: string }>();
    const result = chunkIdsToFilePaths([], entityMap);
    expect(result).toEqual([]);
  });

  it('should deduplicate file paths', () => {
    const entityMap = new Map([
      ['chunk-1', { filePath: 'src/same.ts' }],
      ['chunk-2', { filePath: 'src/same.ts' }],
      ['chunk-3', { filePath: 'src/same.ts' }],
    ]);

    const result = chunkIdsToFilePaths(['chunk-1', 'chunk-2', 'chunk-3'], entityMap);
    expect(result).toEqual(['src/same.ts']);
  });
});

describe('CLI integration with benchmark command', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.name('coderag').version('0.1.0');
    program.exitOverride();
    registerBenchmarkCommand(program);
  });

  it('should register all expected options', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();

    const optionNames = benchmarkCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--queries');
    expect(optionNames).toContain('--output');
    expect(optionNames).toContain('--top-k');
    expect(optionNames).toContain('--seed');
    expect(optionNames).toContain('--skip-grep');
    expect(optionNames).toContain('--skip-tokens');
    expect(optionNames).toContain('--token-budgets');
  });
});
