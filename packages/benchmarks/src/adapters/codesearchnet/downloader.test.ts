/**
 * Tests for the CodeSearchNet downloader and parser.
 *
 * All tests use mock data — no actual network calls.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDownloadUrl,
  buildCachePath,
  parseCSNLine,
  parseCSNJsonl,
  createDefaultDownloadConfig,
} from './downloader.js';
import { CSN_LANGUAGES, CSN_GITHUB_BASE_URL, CSN_DEFAULT_CACHE_DIR } from './types.js';

// --- Helper: create a valid CSN JSONL line ---

function makeCSNJsonLine(overrides: Record<string, unknown> = {}): string {
  const base = {
    repo: 'user/repo',
    path: 'src/module.py',
    func_name: 'calculate_sum',
    code: 'def calculate_sum(a, b):\n    return a + b',
    code_tokens: ['def', 'calculate_sum', '(', 'a', ',', 'b', ')', ':', 'return', 'a', '+', 'b'],
    docstring: 'Calculate the sum of two numbers.',
    docstring_tokens: ['Calculate', 'the', 'sum', 'of', 'two', 'numbers', '.'],
    language: 'python',
    sha: 'abc123def456',
    url: 'https://github.com/user/repo/blob/abc123def456/src/module.py#L1-L2',
    partition: 'test',
    ...overrides,
  };
  return JSON.stringify(base);
}

// --- buildDownloadUrl ---

describe('buildDownloadUrl', () => {
  it('should build correct URL for python', () => {
    const url = buildDownloadUrl('python');
    expect(url).toBe(`${CSN_GITHUB_BASE_URL}/python.zip`);
  });

  it('should build correct URL for each supported language', () => {
    for (const lang of CSN_LANGUAGES) {
      const url = buildDownloadUrl(lang);
      expect(url).toContain(lang);
      expect(url.startsWith(CSN_GITHUB_BASE_URL)).toBe(true);
    }
  });
});

// --- buildCachePath ---

describe('buildCachePath', () => {
  it('should build correct path for language and partition', () => {
    const path = buildCachePath('/cache', 'python', 'test');
    expect(path).toBe('/cache/python/test.jsonl');
  });

  it('should build correct path for different languages', () => {
    const path = buildCachePath('/tmp/csn', 'javascript', 'train');
    expect(path).toBe('/tmp/csn/javascript/train.jsonl');
  });

  it('should handle nested cache directories', () => {
    const path = buildCachePath('/home/user/.cache/csn', 'go', 'valid');
    expect(path).toBe('/home/user/.cache/csn/go/valid.jsonl');
  });
});

// --- parseCSNLine ---

describe('parseCSNLine', () => {
  it('should parse a valid JSONL line', () => {
    const line = makeCSNJsonLine();
    const result = parseCSNLine(line);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.repo).toBe('user/repo');
      expect(result.value.path).toBe('src/module.py');
      expect(result.value.func_name).toBe('calculate_sum');
      expect(result.value.code).toContain('def calculate_sum');
      expect(result.value.docstring).toBe('Calculate the sum of two numbers.');
      expect(result.value.language).toBe('python');
      expect(result.value.partition).toBe('test');
      expect(result.value.code_tokens).toContain('def');
      expect(result.value.docstring_tokens).toContain('Calculate');
    }
  });

  it('should return err for invalid JSON', () => {
    const result = parseCSNLine('not valid json {{{');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Failed to parse JSONL line');
    }
  });

  it('should return err for non-object JSON', () => {
    const result = parseCSNLine('"just a string"');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('not an object');
    }
  });

  it('should return err for missing required string field', () => {
    const line = JSON.stringify({
      repo: 'user/repo',
      // missing path, func_name, etc.
    });
    const result = parseCSNLine(line);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Missing or invalid required field');
    }
  });

  it('should return err for missing array field', () => {
    const line = JSON.stringify({
      repo: 'user/repo',
      path: 'a.py',
      func_name: 'fn',
      code: 'pass',
      docstring: 'doc',
      language: 'python',
      sha: 'abc',
      url: 'https://example.com',
      partition: 'test',
      // missing code_tokens and docstring_tokens
    });
    const result = parseCSNLine(line);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Missing or invalid required array field');
    }
  });

  it('should return err for null JSON', () => {
    const result = parseCSNLine('null');
    expect(result.isErr()).toBe(true);
  });
});

// --- parseCSNJsonl ---

describe('parseCSNJsonl', () => {
  it('should parse multiple valid lines', () => {
    const content = [
      makeCSNJsonLine({ func_name: 'fn1' }),
      makeCSNJsonLine({ func_name: 'fn2' }),
      makeCSNJsonLine({ func_name: 'fn3' }),
    ].join('\n');

    const { entries, parseErrors } = parseCSNJsonl(content);
    expect(entries).toHaveLength(3);
    expect(parseErrors).toBe(0);
    expect(entries[0]?.func_name).toBe('fn1');
    expect(entries[1]?.func_name).toBe('fn2');
    expect(entries[2]?.func_name).toBe('fn3');
  });

  it('should skip empty lines', () => {
    const content = [
      makeCSNJsonLine({ func_name: 'fn1' }),
      '',
      '   ',
      makeCSNJsonLine({ func_name: 'fn2' }),
    ].join('\n');

    const { entries, parseErrors } = parseCSNJsonl(content);
    expect(entries).toHaveLength(2);
    expect(parseErrors).toBe(0);
  });

  it('should count parse errors for invalid lines', () => {
    const content = [
      makeCSNJsonLine({ func_name: 'fn1' }),
      'invalid json line',
      makeCSNJsonLine({ func_name: 'fn2' }),
    ].join('\n');

    const { entries, parseErrors } = parseCSNJsonl(content);
    expect(entries).toHaveLength(2);
    expect(parseErrors).toBe(1);
  });

  it('should apply maxEntries limit', () => {
    const content = [
      makeCSNJsonLine({ func_name: 'fn1' }),
      makeCSNJsonLine({ func_name: 'fn2' }),
      makeCSNJsonLine({ func_name: 'fn3' }),
      makeCSNJsonLine({ func_name: 'fn4' }),
    ].join('\n');

    const { entries, parseErrors } = parseCSNJsonl(content, 2);
    expect(entries).toHaveLength(2);
    expect(parseErrors).toBe(0);
    expect(entries[0]?.func_name).toBe('fn1');
    expect(entries[1]?.func_name).toBe('fn2');
  });

  it('should return all entries when maxEntries is 0', () => {
    const content = [
      makeCSNJsonLine({ func_name: 'fn1' }),
      makeCSNJsonLine({ func_name: 'fn2' }),
    ].join('\n');

    const { entries } = parseCSNJsonl(content, 0);
    expect(entries).toHaveLength(2);
  });

  it('should return empty array for empty content', () => {
    const { entries, parseErrors } = parseCSNJsonl('');
    expect(entries).toHaveLength(0);
    expect(parseErrors).toBe(0);
  });

  it('should return empty array for whitespace-only content', () => {
    const { entries, parseErrors } = parseCSNJsonl('   \n  \n   ');
    expect(entries).toHaveLength(0);
    expect(parseErrors).toBe(0);
  });
});

// --- createDefaultDownloadConfig ---

describe('createDefaultDownloadConfig', () => {
  it('should create config with all defaults', () => {
    const config = createDefaultDownloadConfig();
    expect(config.languages).toEqual([...CSN_LANGUAGES]);
    expect(config.cacheDir).toBe(CSN_DEFAULT_CACHE_DIR);
    expect(config.testOnly).toBe(true);
    expect(config.maxEntriesPerLanguage).toBe(0);
  });

  it('should allow overriding languages', () => {
    const config = createDefaultDownloadConfig({ languages: ['python', 'go'] });
    expect(config.languages).toEqual(['python', 'go']);
    expect(config.cacheDir).toBe(CSN_DEFAULT_CACHE_DIR);
  });

  it('should allow overriding cache directory', () => {
    const config = createDefaultDownloadConfig({ cacheDir: '/tmp/my-cache' });
    expect(config.cacheDir).toBe('/tmp/my-cache');
    expect(config.languages).toEqual([...CSN_LANGUAGES]);
  });

  it('should allow overriding testOnly', () => {
    const config = createDefaultDownloadConfig({ testOnly: false });
    expect(config.testOnly).toBe(false);
  });

  it('should allow overriding maxEntriesPerLanguage', () => {
    const config = createDefaultDownloadConfig({ maxEntriesPerLanguage: 50 });
    expect(config.maxEntriesPerLanguage).toBe(50);
  });

  it('should allow combining overrides', () => {
    const config = createDefaultDownloadConfig({
      languages: ['ruby'],
      cacheDir: '/custom/cache',
      testOnly: false,
      maxEntriesPerLanguage: 200,
    });
    expect(config.languages).toEqual(['ruby']);
    expect(config.cacheDir).toBe('/custom/cache');
    expect(config.testOnly).toBe(false);
    expect(config.maxEntriesPerLanguage).toBe(200);
  });
});
