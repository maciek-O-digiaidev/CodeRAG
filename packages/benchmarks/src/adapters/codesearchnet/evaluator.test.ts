/**
 * Tests for the CodeSearchNet evaluator.
 *
 * Verifies the evaluation pipeline: token overlap retrieval,
 * per-language evaluation, full CSN evaluation, and report formatting.
 *
 * All tests use in-memory data — no network calls or file system access.
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultEvaluationConfig,
  createTokenOverlapRetrievalFn,
  evaluateLanguage,
  evaluateCSN,
  formatCSNReportJson,
  formatCSNReportMarkdown,
} from './evaluator.js';
import { buildCodeCorpus, generateChunkId } from './adapter.js';
import type { CSNEntry, CSNDataset, CSNLanguage, CSNEvaluationConfig } from './types.js';
import { CSN_DEFAULT_OUTPUT_DIR } from './types.js';

// --- Helper: create mock CSN entries and datasets ---

function makeEntry(overrides: Partial<CSNEntry> = {}): CSNEntry {
  return {
    repo: 'user/repo',
    path: 'src/utils.py',
    func_name: 'calculate_sum',
    code: 'def calculate_sum(a, b):\n    return a + b',
    code_tokens: ['def', 'calculate_sum', 'a', 'b', 'return', 'a', '+', 'b'],
    docstring: 'Calculate the sum of two numbers and return the result.',
    docstring_tokens: ['Calculate', 'the', 'sum', 'of', 'two', 'numbers', 'and', 'return', 'the', 'result', '.'],
    language: 'python',
    sha: 'abc123',
    url: 'https://github.com/user/repo/blob/abc123/src/utils.py',
    partition: 'test',
    ...overrides,
  };
}

function makeDataset(
  languageEntries: Map<CSNLanguage, CSNEntry[]>,
): CSNDataset {
  let totalEntries = 0;
  for (const entries of languageEntries.values()) {
    totalEntries += entries.length;
  }
  return {
    languages: [...languageEntries.keys()],
    entries: languageEntries,
    totalEntries,
  };
}

// --- createDefaultEvaluationConfig ---

describe('createDefaultEvaluationConfig', () => {
  it('should create config with defaults', () => {
    const config = createDefaultEvaluationConfig();
    expect(config.languages).toEqual(['python']);
    expect(config.maxEntriesPerLanguage).toBe(100);
    expect(config.outputDir).toBe(CSN_DEFAULT_OUTPUT_DIR);
  });

  it('should allow overriding languages', () => {
    const config = createDefaultEvaluationConfig({ languages: ['go', 'java'] });
    expect(config.languages).toEqual(['go', 'java']);
  });

  it('should allow overriding maxEntriesPerLanguage', () => {
    const config = createDefaultEvaluationConfig({ maxEntriesPerLanguage: 50 });
    expect(config.maxEntriesPerLanguage).toBe(50);
  });

  it('should allow overriding outputDir', () => {
    const config = createDefaultEvaluationConfig({ outputDir: '/custom/output' });
    expect(config.outputDir).toBe('/custom/output');
  });
});

// --- createTokenOverlapRetrievalFn ---

describe('createTokenOverlapRetrievalFn', () => {
  it('should return matching chunks by token overlap', async () => {
    const entries = [
      makeEntry({
        func_name: 'calculate_sum',
        code: 'def calculate_sum(a, b): return a + b',
        docstring: 'Calculate the sum',
        docstring_tokens: ['Calculate', 'the', 'sum'],
      }),
      makeEntry({
        func_name: 'multiply',
        code: 'def multiply(a, b): return a * b',
        docstring: 'Multiply two numbers',
        docstring_tokens: ['Multiply', 'two', 'numbers'],
      }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const corpus = buildCodeCorpus(dataset);
    const retrievalFn = createTokenOverlapRetrievalFn(corpus);

    // Query about "calculate sum" should find calculate_sum
    const results = await retrievalFn('calculate sum return');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should return empty array for queries with no matches', async () => {
    const entries = [
      makeEntry({
        func_name: 'fn1',
        code: 'def fn1(): pass',
      }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const corpus = buildCodeCorpus(dataset);
    const retrievalFn = createTokenOverlapRetrievalFn(corpus);

    const results = await retrievalFn('zzzzz yyyyy xxxxx');
    expect(results).toHaveLength(0);
  });

  it('should respect topK parameter', async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({
        func_name: `calculate_fn_${i}`,
        code: `def calculate_fn_${i}(): return ${i}`,
      }),
    );
    const dataset = makeDataset(new Map([['python', entries]]));
    const corpus = buildCodeCorpus(dataset);
    const retrievalFn = createTokenOverlapRetrievalFn(corpus, 5);

    const results = await retrievalFn('calculate return def');
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('should score higher overlap chunks first', async () => {
    const entries = [
      makeEntry({
        func_name: 'low_match',
        code: 'def low_match(): pass',
      }),
      makeEntry({
        func_name: 'high_match',
        code: 'def high_match(): calculate sum total result numbers',
      }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const corpus = buildCodeCorpus(dataset);
    const retrievalFn = createTokenOverlapRetrievalFn(corpus, 10);

    const results = await retrievalFn('calculate sum total result numbers');

    // high_match should rank higher due to more token overlap
    const highMatchId = generateChunkId(entries[1]!);
    if (results.length >= 2) {
      expect(results[0]).toBe(highMatchId);
    }
  });

  it('should handle empty corpus', async () => {
    const dataset = makeDataset(new Map());
    const corpus = buildCodeCorpus(dataset);
    const retrievalFn = createTokenOverlapRetrievalFn(corpus);

    const results = await retrievalFn('any query');
    expect(results).toHaveLength(0);
  });
});

// --- evaluateLanguage ---

describe('evaluateLanguage', () => {
  it('should evaluate a single language and produce metrics', async () => {
    const entries = [
      makeEntry({
        func_name: 'fn1',
        code: 'def fn1(): calculate sum',
        docstring: 'Calculate the sum',
        docstring_tokens: ['Calculate', 'the', 'sum'],
      }),
      makeEntry({
        func_name: 'fn2',
        code: 'def fn2(): process data',
        docstring: 'Process the data',
        docstring_tokens: ['Process', 'the', 'data'],
      }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const corpus = buildCodeCorpus(dataset);
    const retrievalFn = createTokenOverlapRetrievalFn(corpus);

    const result = await evaluateLanguage(dataset, 'python', retrievalFn);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.language).toBe('python');
      expect(result.value.report.metadata.datasetName).toBe('CodeSearchNet-python');
      expect(result.value.report.metadata.queryCount).toBe(2);
      expect(result.value.report.aggregate.mrr).toBeGreaterThanOrEqual(0);
      expect(result.value.report.aggregate.mrr).toBeLessThanOrEqual(1);
    }
  });

  it('should return err for missing language', async () => {
    const dataset = makeDataset(new Map([['python', [makeEntry()]]]));
    const retrievalFn = async () => [] as readonly string[];

    const result = await evaluateLanguage(dataset, 'go', retrievalFn);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No entries found for language: go');
    }
  });

  it('should return err when all entries have empty docstrings', async () => {
    const entries = [
      makeEntry({ docstring: '', docstring_tokens: [] }),
      makeEntry({ func_name: 'fn2', docstring: ' ', docstring_tokens: [] }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const retrievalFn = async () => [] as readonly string[];

    const result = await evaluateLanguage(dataset, 'python', retrievalFn);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No valid queries');
    }
  });

  it('should respect maxEntries parameter', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        func_name: `fn${i}`,
        docstring: `Function number ${i} does something useful`,
        docstring_tokens: ['Function', 'number', String(i), 'does', 'something', 'useful'],
      }),
    );
    const dataset = makeDataset(new Map([['python', entries]]));
    const retrievalFn = async () => [] as readonly string[];

    const result = await evaluateLanguage(dataset, 'python', retrievalFn, 3);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.report.metadata.queryCount).toBe(3);
    }
  });
});

// --- evaluateCSN ---

describe('evaluateCSN', () => {
  it('should evaluate multiple languages and produce aggregate report', async () => {
    const pyEntries = [
      makeEntry({
        language: 'python',
        func_name: 'py_fn',
        code: 'def py_fn(): python calculate sum',
        docstring: 'Calculate python sum',
        docstring_tokens: ['Calculate', 'python', 'sum'],
      }),
    ];
    const jsEntries = [
      makeEntry({
        language: 'javascript',
        func_name: 'js_fn',
        code: 'function jsFn() { javascript process }',
        docstring: 'Process javascript data',
        docstring_tokens: ['Process', 'javascript', 'data'],
      }),
    ];
    const dataset = makeDataset(
      new Map<CSNLanguage, CSNEntry[]>([
        ['python', pyEntries],
        ['javascript', jsEntries],
      ]),
    );
    const corpus = buildCodeCorpus(dataset);
    const retrievalFn = createTokenOverlapRetrievalFn(corpus);

    const config: CSNEvaluationConfig = {
      languages: ['python', 'javascript'],
      maxEntriesPerLanguage: 100,
      outputDir: '/tmp/test-results',
    };

    const result = await evaluateCSN(dataset, retrievalFn, config);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.languageResults).toHaveLength(2);
      expect(result.value.languageResults[0]?.language).toBe('python');
      expect(result.value.languageResults[1]?.language).toBe('javascript');
      expect(result.value.aggregateReport.metadata.queryCount).toBe(2);
      expect(result.value.aggregateMetrics.mrr).toBeGreaterThanOrEqual(0);
    }
  });

  it('should return err when a language has no entries', async () => {
    const dataset = makeDataset(new Map([['python', [makeEntry()]]]));
    const retrievalFn = async () => [] as readonly string[];

    const config: CSNEvaluationConfig = {
      languages: ['python', 'go'], // go has no entries
      maxEntriesPerLanguage: 100,
      outputDir: '/tmp/test-results',
    };

    const result = await evaluateCSN(dataset, retrievalFn, config);
    expect(result.isErr()).toBe(true);
  });
});

// --- formatCSNReportJson ---

describe('formatCSNReportJson', () => {
  it('should produce valid JSON', async () => {
    const entries = [
      makeEntry({
        func_name: 'fn1',
        docstring: 'Test function one',
        docstring_tokens: ['Test', 'function', 'one'],
      }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const corpus = buildCodeCorpus(dataset);
    const retrievalFn = createTokenOverlapRetrievalFn(corpus);

    const config: CSNEvaluationConfig = {
      languages: ['python'],
      maxEntriesPerLanguage: 100,
      outputDir: '/tmp/results',
    };

    const evalResult = await evaluateCSN(dataset, retrievalFn, config);
    expect(evalResult.isOk()).toBe(true);

    if (evalResult.isOk()) {
      const json = formatCSNReportJson(evalResult.value);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed['config']).toBeDefined();
      expect(parsed['aggregate']).toBeDefined();
      expect(parsed['perLanguage']).toBeDefined();
    }
  });

  it('should include config and metrics in JSON output', async () => {
    const entries = [
      makeEntry({
        docstring: 'Test function here',
        docstring_tokens: ['Test', 'function', 'here'],
      }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const retrievalFn = async () => [] as readonly string[];

    const config: CSNEvaluationConfig = {
      languages: ['python'],
      maxEntriesPerLanguage: 100,
      outputDir: '/tmp/results',
    };

    const evalResult = await evaluateCSN(dataset, retrievalFn, config);
    expect(evalResult.isOk()).toBe(true);

    if (evalResult.isOk()) {
      const json = formatCSNReportJson(evalResult.value);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const aggregate = parsed['aggregate'] as Record<string, unknown>;
      expect(aggregate['metrics']).toBeDefined();
      expect(aggregate['queryCount']).toBe(1);
    }
  });
});

// --- formatCSNReportMarkdown ---

describe('formatCSNReportMarkdown', () => {
  it('should produce markdown with aggregate metrics', async () => {
    const entries = [
      makeEntry({
        docstring: 'Test function here',
        docstring_tokens: ['Test', 'function', 'here'],
      }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const retrievalFn = async () => [] as readonly string[];

    const config: CSNEvaluationConfig = {
      languages: ['python'],
      maxEntriesPerLanguage: 100,
      outputDir: '/tmp/results',
    };

    const evalResult = await evaluateCSN(dataset, retrievalFn, config);
    expect(evalResult.isOk()).toBe(true);

    if (evalResult.isOk()) {
      const md = formatCSNReportMarkdown(evalResult.value);
      expect(md).toContain('# CodeSearchNet Evaluation Report');
      expect(md).toContain('## Aggregate Metrics');
      expect(md).toContain('| MRR |');
      expect(md).toContain('| Precision@5 |');
      expect(md).toContain('| nDCG@10 |');
      expect(md).toContain('python');
    }
  });

  it('should include per-language breakdown for multi-language evaluations', async () => {
    const pyEntries = [
      makeEntry({
        language: 'python',
        func_name: 'py_fn',
        docstring: 'Python test function',
        docstring_tokens: ['Python', 'test', 'function'],
      }),
    ];
    const jsEntries = [
      makeEntry({
        language: 'javascript',
        func_name: 'js_fn',
        docstring: 'JavaScript test function',
        docstring_tokens: ['JavaScript', 'test', 'function'],
      }),
    ];
    const dataset = makeDataset(
      new Map<CSNLanguage, CSNEntry[]>([
        ['python', pyEntries],
        ['javascript', jsEntries],
      ]),
    );
    const retrievalFn = async () => [] as readonly string[];

    const config: CSNEvaluationConfig = {
      languages: ['python', 'javascript'],
      maxEntriesPerLanguage: 100,
      outputDir: '/tmp/results',
    };

    const evalResult = await evaluateCSN(dataset, retrievalFn, config);
    expect(evalResult.isOk()).toBe(true);

    if (evalResult.isOk()) {
      const md = formatCSNReportMarkdown(evalResult.value);
      expect(md).toContain('## Per-Language Results');
      expect(md).toContain('| python |');
      expect(md).toContain('| javascript |');
    }
  });

  it('should include published baselines reference', async () => {
    const entries = [
      makeEntry({
        docstring: 'Test function here',
        docstring_tokens: ['Test', 'function', 'here'],
      }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const retrievalFn = async () => [] as readonly string[];

    const config: CSNEvaluationConfig = {
      languages: ['python'],
      maxEntriesPerLanguage: 100,
      outputDir: '/tmp/results',
    };

    const evalResult = await evaluateCSN(dataset, retrievalFn, config);
    expect(evalResult.isOk()).toBe(true);

    if (evalResult.isOk()) {
      const md = formatCSNReportMarkdown(evalResult.value);
      expect(md).toContain('## CodeSearchNet Published Baselines (MRR)');
      expect(md).toContain('Neural BoW');
      expect(md).toContain('0.585');
    }
  });
});
