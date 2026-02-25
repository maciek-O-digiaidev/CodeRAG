import { describe, it, expect, vi } from 'vitest';
import {
  buildApiUrl,
  parseRepoBenchRow,
  fetchRepoBenchEntries,
  downloadRepoBench,
  DATASET_CONFIGS,
  MAX_ROWS_PER_REQUEST,
  HUGGINGFACE_API_BASE,
} from './downloader.js';
import type { HuggingFaceDatasetInfo } from './types.js';

// --- buildApiUrl ---

describe('buildApiUrl', () => {
  it('should build correct URL with default base', () => {
    const info: HuggingFaceDatasetInfo = {
      repoPath: 'tianyang/repobench-r',
      config: 'cross_file_random',
      split: 'test',
    };
    const url = buildApiUrl(info, 0, 50);

    expect(url).toContain(HUGGINGFACE_API_BASE);
    expect(url).toContain('dataset=tianyang%2Frepobench-r');
    expect(url).toContain('config=cross_file_random');
    expect(url).toContain('split=test');
    expect(url).toContain('offset=0');
    expect(url).toContain('length=50');
  });

  it('should cap length at MAX_ROWS_PER_REQUEST', () => {
    const info: HuggingFaceDatasetInfo = {
      repoPath: 'test/repo',
      config: 'cfg',
      split: 'test',
    };
    const url = buildApiUrl(info, 0, 500);
    expect(url).toContain(`length=${MAX_ROWS_PER_REQUEST}`);
  });

  it('should use custom base URL', () => {
    const info: HuggingFaceDatasetInfo = {
      repoPath: 'test/repo',
      config: 'cfg',
      split: 'test',
    };
    const url = buildApiUrl(info, 10, 20, 'https://custom.api.com');
    expect(url).toContain('https://custom.api.com');
    expect(url).toContain('offset=10');
  });

  it('should include offset and length parameters', () => {
    const info: HuggingFaceDatasetInfo = {
      repoPath: 'test/repo',
      config: 'cfg',
      split: 'train',
    };
    const url = buildApiUrl(info, 42, 10);
    expect(url).toContain('offset=42');
    expect(url).toContain('length=10');
  });
});

// --- parseRepoBenchRow ---

describe('parseRepoBenchRow', () => {
  const validRow: Record<string, unknown> = {
    repo_name: 'owner/repo',
    file_path: 'src/main.py',
    context: 'import foo\n\ndef bar():',
    import_statement: 'from foo import baz',
    gold_snippet_code: 'def baz():\n    return 42',
    cross_file_context: [
      { file_path: 'src/foo.py', code: 'def baz():\n    return 42' },
    ],
  };

  it('should parse a valid row', () => {
    const result = parseRepoBenchRow(validRow);
    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      expect(result.value.repo_name).toBe('owner/repo');
      expect(result.value.file_path).toBe('src/main.py');
      expect(result.value.import_statement).toBe('from foo import baz');
      expect(result.value.gold_snippet_code).toBe('def baz():\n    return 42');
      expect(result.value.cross_file_context).toHaveLength(1);
      expect(result.value.cross_file_context[0]?.file_path).toBe('src/foo.py');
    }
  });

  it('should return err for missing required fields', () => {
    const invalidRow = { repo_name: 'owner/repo' };
    const result = parseRepoBenchRow(invalidRow);
    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.kind).toBe('parse');
    }
  });

  it('should return err for non-string required fields', () => {
    const invalidRow = {
      ...validRow,
      repo_name: 123,
    };
    const result = parseRepoBenchRow(invalidRow);
    expect(result.isErr()).toBe(true);
  });

  it('should handle missing cross_file_context gracefully', () => {
    const rowWithoutCross = { ...validRow };
    delete rowWithoutCross['cross_file_context'];
    const result = parseRepoBenchRow(rowWithoutCross);
    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      expect(result.value.cross_file_context).toHaveLength(0);
    }
  });

  it('should handle non-array cross_file_context', () => {
    const rowWithBadCross = { ...validRow, cross_file_context: 'not an array' };
    const result = parseRepoBenchRow(rowWithBadCross);
    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      expect(result.value.cross_file_context).toHaveLength(0);
    }
  });

  it('should skip malformed cross_file_context items', () => {
    const rowWithMixedCross = {
      ...validRow,
      cross_file_context: [
        { file_path: 'good.py', code: 'good code' },
        { bad_key: 'no file_path or code' },
        { file_path: 'another.py', code: 'more code' },
      ],
    };
    const result = parseRepoBenchRow(rowWithMixedCross);
    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      expect(result.value.cross_file_context).toHaveLength(2);
    }
  });
});

// --- DATASET_CONFIGS ---

describe('DATASET_CONFIGS', () => {
  it('should have configs for python and java', () => {
    expect(DATASET_CONFIGS.python).toBeDefined();
    expect(DATASET_CONFIGS.java).toBeDefined();
  });

  it('should use the correct dataset repo path', () => {
    expect(DATASET_CONFIGS.python.repoPath).toBe('tianyang/repobench-r');
    expect(DATASET_CONFIGS.java.repoPath).toBe('tianyang/repobench-r');
  });

  it('should use cross_file_random config', () => {
    expect(DATASET_CONFIGS.python.config).toBe('cross_file_random');
    expect(DATASET_CONFIGS.java.config).toBe('cross_file_random');
  });
});

// --- fetchRepoBenchEntries ---

describe('fetchRepoBenchEntries', () => {
  it('should fetch and parse entries from mock API', async () => {
    const mockResponse = {
      rows: [
        {
          row_idx: 0,
          row: {
            repo_name: 'test/repo',
            file_path: 'src/main.py',
            context: 'import utils',
            import_statement: 'from utils import helper',
            gold_snippet_code: 'def helper(): pass',
            cross_file_context: [
              { file_path: 'src/utils.py', code: 'def helper(): pass' },
            ],
          },
        },
      ],
    };

    const mockFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await fetchRepoBenchEntries('python', 10, mockFetch);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.repo_name).toBe('test/repo');
    }

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0]?.[0];
    expect(String(calledUrl)).toContain('dataset=tianyang%2Frepobench-r');
  });

  it('should return error on network failure', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(
      new Error('Network timeout'),
    );

    const result = await fetchRepoBenchEntries('python', 10, mockFetch);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('network');
      expect(result.error.message).toContain('Network timeout');
    }
  });

  it('should return error on non-OK HTTP status', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    const result = await fetchRepoBenchEntries('java', 10, mockFetch);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('network');
    }
  });

  it('should return error on invalid JSON response', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ no_rows: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await fetchRepoBenchEntries('python', 10, mockFetch);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('parse');
    }
  });

  it('should skip unparseable rows gracefully', async () => {
    const mockResponse = {
      rows: [
        {
          row_idx: 0,
          row: {
            repo_name: 'test/repo',
            file_path: 'src/main.py',
            context: 'import utils',
            import_statement: 'from utils import helper',
            gold_snippet_code: 'def helper(): pass',
            cross_file_context: [],
          },
        },
        {
          row_idx: 1,
          row: { bad: 'data' }, // Invalid row
        },
      ],
    };

    const mockFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await fetchRepoBenchEntries('python', 10, mockFetch);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Only the valid row should be included
      expect(result.value).toHaveLength(1);
    }
  });
});

// --- downloadRepoBench ---

describe('downloadRepoBench', () => {
  it('should download entries for multiple languages', async () => {
    const mockFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async (input) => {
        const url = String(input);
        const entry: Record<string, unknown> = {
          repo_name: url.includes('python') ? 'py/repo' : 'java/repo',
          file_path: 'src/main.' + (url.includes('python') ? 'py' : 'java'),
          context: 'some context',
          import_statement: 'import foo',
          gold_snippet_code: 'code',
          cross_file_context: [],
        };

        // Both use same config so we can't distinguish by URL — return same data
        return new Response(
          JSON.stringify({ rows: [{ row_idx: 0, row: entry }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    );

    const result = await downloadRepoBench(
      {
        outputDir: '/tmp/repobench',
        languages: ['python', 'java'],
        maxEntriesPerLanguage: 5,
      },
      mockFetch,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.size).toBe(2);
      expect(result.value.has('python')).toBe(true);
      expect(result.value.has('java')).toBe(true);
    }

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should return error if any language download fails', async () => {
    let callCount = 0;
    const mockFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            rows: [{
              row_idx: 0,
              row: {
                repo_name: 'test/repo',
                file_path: 'main.py',
                context: 'ctx',
                import_statement: 'import x',
                gold_snippet_code: 'code',
                cross_file_context: [],
              },
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Error', { status: 500, statusText: 'Server Error' });
    });

    const result = await downloadRepoBench(
      {
        outputDir: '/tmp/repobench',
        languages: ['python', 'java'],
      },
      mockFetch,
    );

    expect(result.isErr()).toBe(true);
  });
});
