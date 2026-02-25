/**
 * Tests for the CodeSearchNet adapter.
 *
 * Verifies conversion from CSN entries to GenericBenchmarkDataset,
 * chunk ID generation, corpus building, and docstring filtering.
 */

import { describe, it, expect } from 'vitest';
import {
  generateChunkId,
  buildCodeCorpus,
  filterByDocstringQuality,
  adaptCSNToGenericDataset,
  adaptCSNLanguageSubset,
} from './adapter.js';
import type { CSNEntry, CSNDataset, CSNLanguage } from './types.js';

// --- Helper: create mock CSN entries ---

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

// --- generateChunkId ---

describe('generateChunkId', () => {
  it('should generate deterministic chunk ID', () => {
    const entry = makeEntry();
    const id = generateChunkId(entry);
    expect(id).toBe('python:user/repo:src/utils.py:calculate_sum');
  });

  it('should produce unique IDs for different functions in same file', () => {
    const entry1 = makeEntry({ func_name: 'func_a' });
    const entry2 = makeEntry({ func_name: 'func_b' });
    expect(generateChunkId(entry1)).not.toBe(generateChunkId(entry2));
  });

  it('should produce unique IDs for same function in different repos', () => {
    const entry1 = makeEntry({ repo: 'user/repo-a' });
    const entry2 = makeEntry({ repo: 'user/repo-b' });
    expect(generateChunkId(entry1)).not.toBe(generateChunkId(entry2));
  });

  it('should produce unique IDs for different languages', () => {
    const entry1 = makeEntry({ language: 'python' });
    const entry2 = makeEntry({ language: 'javascript' });
    expect(generateChunkId(entry1)).not.toBe(generateChunkId(entry2));
  });

  it('should include all components in the ID', () => {
    const entry = makeEntry({
      language: 'go',
      repo: 'org/project',
      path: 'pkg/main.go',
      func_name: 'Start',
    });
    const id = generateChunkId(entry);
    expect(id).toBe('go:org/project:pkg/main.go:Start');
  });
});

// --- buildCodeCorpus ---

describe('buildCodeCorpus', () => {
  it('should build corpus from single language dataset', () => {
    const entries = [
      makeEntry({ func_name: 'fn1', code: 'code1' }),
      makeEntry({ func_name: 'fn2', code: 'code2' }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));
    const corpus = buildCodeCorpus(dataset);

    expect(corpus.size).toBe(2);
    expect(corpus.chunks.size).toBe(2);
    expect(corpus.entries.size).toBe(2);
  });

  it('should map chunk IDs to code content', () => {
    const entry = makeEntry({ func_name: 'my_func', code: 'def my_func(): pass' });
    const dataset = makeDataset(new Map([['python', [entry]]]));
    const corpus = buildCodeCorpus(dataset);

    const chunkId = generateChunkId(entry);
    expect(corpus.chunks.get(chunkId)).toBe('def my_func(): pass');
  });

  it('should map chunk IDs to full entries', () => {
    const entry = makeEntry({ func_name: 'my_func' });
    const dataset = makeDataset(new Map([['python', [entry]]]));
    const corpus = buildCodeCorpus(dataset);

    const chunkId = generateChunkId(entry);
    const stored = corpus.entries.get(chunkId);
    expect(stored?.func_name).toBe('my_func');
    expect(stored?.repo).toBe('user/repo');
  });

  it('should handle multi-language datasets', () => {
    const pyEntries = [makeEntry({ language: 'python', func_name: 'py_fn' })];
    const jsEntries = [makeEntry({ language: 'javascript', func_name: 'js_fn' })];
    const dataset = makeDataset(
      new Map<CSNLanguage, CSNEntry[]>([
        ['python', pyEntries],
        ['javascript', jsEntries],
      ]),
    );
    const corpus = buildCodeCorpus(dataset);

    expect(corpus.size).toBe(2);
  });

  it('should return empty corpus for empty dataset', () => {
    const dataset = makeDataset(new Map());
    const corpus = buildCodeCorpus(dataset);

    expect(corpus.size).toBe(0);
    expect(corpus.chunks.size).toBe(0);
  });
});

// --- filterByDocstringQuality ---

describe('filterByDocstringQuality', () => {
  it('should keep entries with sufficient docstring tokens', () => {
    const entries = [
      makeEntry({ docstring: 'good docstring here', docstring_tokens: ['good', 'docstring', 'here'] }),
    ];
    const filtered = filterByDocstringQuality(entries, 3);
    expect(filtered).toHaveLength(1);
  });

  it('should filter out entries with empty docstrings', () => {
    const entries = [
      makeEntry({ docstring: '', docstring_tokens: [] }),
    ];
    const filtered = filterByDocstringQuality(entries);
    expect(filtered).toHaveLength(0);
  });

  it('should filter out entries with whitespace-only docstrings', () => {
    const entries = [
      makeEntry({ docstring: '   ', docstring_tokens: [] }),
    ];
    const filtered = filterByDocstringQuality(entries);
    expect(filtered).toHaveLength(0);
  });

  it('should filter out entries with too few docstring tokens', () => {
    const entries = [
      makeEntry({
        docstring: 'ab',
        docstring_tokens: ['ab'],
      }),
    ];
    const filtered = filterByDocstringQuality(entries, 3);
    expect(filtered).toHaveLength(0);
  });

  it('should respect custom minTokens threshold', () => {
    const entries = [
      makeEntry({ docstring: 'a b', docstring_tokens: ['a', 'b'] }),
      makeEntry({ docstring: 'a b c d e', docstring_tokens: ['a', 'b', 'c', 'd', 'e'] }),
    ];
    const filtered = filterByDocstringQuality(entries, 5);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.docstring).toBe('a b c d e');
  });

  it('should use default minTokens of 3', () => {
    const entries = [
      makeEntry({ docstring: 'ab', docstring_tokens: ['ab', 'cd'] }),
      makeEntry({ docstring: 'a b c', docstring_tokens: ['a', 'b', 'c'] }),
    ];
    const filtered = filterByDocstringQuality(entries);
    expect(filtered).toHaveLength(1);
  });

  it('should return empty array for empty input', () => {
    const filtered = filterByDocstringQuality([]);
    expect(filtered).toHaveLength(0);
  });
});

// --- adaptCSNToGenericDataset ---

describe('adaptCSNToGenericDataset', () => {
  it('should convert CSN dataset to generic benchmark dataset', () => {
    const entries = [
      makeEntry({ func_name: 'fn1', docstring: 'Do something useful', docstring_tokens: ['Do', 'something', 'useful'] }),
      makeEntry({ func_name: 'fn2', docstring: 'Process the data', docstring_tokens: ['Process', 'the', 'data'] }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));

    const generic = adaptCSNToGenericDataset(dataset);

    expect(generic.queries).toHaveLength(2);
    expect(generic.queries[0]?.query).toBe('Do something useful');
    expect(generic.queries[0]?.expectedChunkIds).toHaveLength(1);
    expect(generic.queries[0]?.context).toContain('def calculate_sum');
  });

  it('should set expectedChunkIds to deterministic chunk IDs', () => {
    const entry = makeEntry({ func_name: 'target_fn' });
    const dataset = makeDataset(new Map([['python', [entry]]]));

    const generic = adaptCSNToGenericDataset(dataset);

    const expectedId = generateChunkId(entry);
    expect(generic.queries[0]?.expectedChunkIds[0]).toBe(expectedId);
  });

  it('should filter entries with poor docstrings', () => {
    const entries = [
      makeEntry({ func_name: 'good', docstring: 'Calculate the sum of numbers', docstring_tokens: ['Calculate', 'the', 'sum', 'of', 'numbers'] }),
      makeEntry({ func_name: 'bad', docstring: '', docstring_tokens: [] }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));

    const generic = adaptCSNToGenericDataset(dataset);
    expect(generic.queries).toHaveLength(1);
  });

  it('should respect maxQueries option', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        func_name: `fn${i}`,
        docstring: `Function number ${i} does something`,
        docstring_tokens: ['Function', 'number', String(i), 'does', 'something'],
      }),
    );
    const dataset = makeDataset(new Map([['python', entries]]));

    const generic = adaptCSNToGenericDataset(dataset, { maxQueries: 3 });
    expect(generic.queries).toHaveLength(3);
  });

  it('should include metadata about the source', () => {
    const dataset = makeDataset(new Map([['python', [makeEntry()]]]));
    const generic = adaptCSNToGenericDataset(dataset);

    expect(generic.metadata).toBeDefined();
    const meta = generic.metadata as Record<string, unknown>;
    expect(meta['source']).toBe('CodeSearchNet');
    expect(meta['languages']).toEqual(['python']);
  });

  it('should handle multi-language datasets', () => {
    const pyEntry = makeEntry({ language: 'python', func_name: 'py_fn' });
    const jsEntry = makeEntry({ language: 'javascript', func_name: 'js_fn' });
    const dataset = makeDataset(
      new Map<CSNLanguage, CSNEntry[]>([
        ['python', [pyEntry]],
        ['javascript', [jsEntry]],
      ]),
    );

    const generic = adaptCSNToGenericDataset(dataset);
    expect(generic.queries).toHaveLength(2);
  });

  it('should produce empty dataset when all entries are filtered out', () => {
    const entries = [
      makeEntry({ docstring: '', docstring_tokens: [] }),
    ];
    const dataset = makeDataset(new Map([['python', entries]]));

    const generic = adaptCSNToGenericDataset(dataset);
    expect(generic.queries).toHaveLength(0);
  });
});

// --- adaptCSNLanguageSubset ---

describe('adaptCSNLanguageSubset', () => {
  it('should adapt entries for a single language', () => {
    const entries = [
      makeEntry({ func_name: 'fn1', docstring: 'First function here', docstring_tokens: ['First', 'function', 'here'] }),
      makeEntry({ func_name: 'fn2', docstring: 'Second function here', docstring_tokens: ['Second', 'function', 'here'] }),
    ];

    const generic = adaptCSNLanguageSubset(entries, 'python');
    expect(generic.queries).toHaveLength(2);
  });

  it('should include language in metadata', () => {
    const entries = [makeEntry()];
    const generic = adaptCSNLanguageSubset(entries, 'python');

    const meta = generic.metadata as Record<string, unknown>;
    expect(meta['language']).toBe('python');
    expect(meta['source']).toBe('CodeSearchNet');
  });

  it('should respect maxQueries option', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        func_name: `fn${i}`,
        docstring: `Function number ${i} does something`,
        docstring_tokens: ['Function', 'number', String(i), 'does', 'something'],
      }),
    );

    const generic = adaptCSNLanguageSubset(entries, 'python', { maxQueries: 5 });
    expect(generic.queries).toHaveLength(5);
  });

  it('should filter by docstring quality', () => {
    const entries = [
      makeEntry({ func_name: 'good', docstring: 'A good docstring with tokens', docstring_tokens: ['A', 'good', 'docstring', 'with', 'tokens'] }),
      makeEntry({ func_name: 'bad', docstring: 'x', docstring_tokens: ['x'] }),
    ];

    const generic = adaptCSNLanguageSubset(entries, 'python');
    expect(generic.queries).toHaveLength(1);
    expect(generic.queries[0]?.query).toBe('A good docstring with tokens');
  });

  it('should return empty dataset for empty entries', () => {
    const generic = adaptCSNLanguageSubset([], 'python');
    expect(generic.queries).toHaveLength(0);
  });
});
