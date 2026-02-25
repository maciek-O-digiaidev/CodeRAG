import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerBenchmarkCommand, formatColoredSummary } from './benchmark-cmd.js';
import type { BenchmarkReport } from '@code-rag/core';

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

  it('should have a description', () => {
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    expect(benchmarkCmd!.description()).toBeTruthy();
    expect(benchmarkCmd!.description()).toContain('benchmark');
  });
});

describe('formatColoredSummary', () => {
  it('should produce formatted output with all sections', () => {
    const report: BenchmarkReport = {
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

    const output = formatColoredSummary(report);
    // The output contains ANSI color codes but the text should be present
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
    const report: BenchmarkReport = {
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

    const output = formatColoredSummary(report);
    expect(output).toContain('Benchmark Results');
    expect(output).not.toContain('By Query Type');
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
  });
});
