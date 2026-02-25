import { describe, it, expect } from 'vitest';
import {
  entryToTask,
  buildRetrievalQuery,
  truncateContext,
  entriesToTasks,
  tasksToDataset,
  convertToDataset,
} from './adapter.js';
import type { RepoBenchEntry } from './types.js';

// --- Test fixtures ---

const sampleEntry: RepoBenchEntry = {
  repo_name: 'owner/my-repo',
  file_path: 'src/main.py',
  context: 'import numpy as np\nfrom utils import helper\n\ndef process():\n    result = helper()',
  import_statement: 'from utils import helper',
  gold_snippet_code: 'def helper():\n    return np.array([1, 2, 3])',
  cross_file_context: [
    { file_path: 'src/utils.py', code: 'def helper():\n    return np.array([1, 2, 3])' },
  ],
};

const sampleJavaEntry: RepoBenchEntry = {
  repo_name: 'org/java-project',
  file_path: 'src/Main.java',
  context: 'import com.example.Service;\n\npublic class Main {\n    Service svc = new Service();',
  import_statement: 'import com.example.Service;',
  gold_snippet_code: 'public class Service {\n    public void run() {}\n}',
  cross_file_context: [
    {
      file_path: 'src/com/example/Service.java',
      code: 'public class Service {\n    public void run() {}\n}',
    },
  ],
};

// --- entryToTask ---

describe('entryToTask', () => {
  it('should convert entry to task with correct id', () => {
    const task = entryToTask(sampleEntry, 'python', 0);

    expect(task.id).toBe('owner_my-repo__src_main_py__0');
    expect(task.language).toBe('python');
    expect(task.repoName).toBe('owner/my-repo');
    expect(task.sourceFilePath).toBe('src/main.py');
  });

  it('should extract expected file paths from cross_file_context', () => {
    const task = entryToTask(sampleEntry, 'python', 0);

    expect(task.expectedFilePaths).toEqual(['src/utils.py']);
  });

  it('should extract gold snippets', () => {
    const task = entryToTask(sampleEntry, 'python', 0);

    expect(task.goldSnippets).toEqual([
      'def helper():\n    return np.array([1, 2, 3])',
    ]);
  });

  it('should build a meaningful query', () => {
    const task = entryToTask(sampleEntry, 'python', 0);

    expect(task.query).toContain('Python');
    expect(task.query).toContain('from utils import helper');
  });

  it('should handle Java entries', () => {
    const task = entryToTask(sampleJavaEntry, 'java', 5);

    expect(task.language).toBe('java');
    expect(task.id).toContain('org_java-project');
    expect(task.id).toContain('5');
    expect(task.query).toContain('Java');
    expect(task.expectedFilePaths).toEqual(['src/com/example/Service.java']);
  });

  it('should handle entry with multiple cross-file contexts', () => {
    const multiEntry: RepoBenchEntry = {
      ...sampleEntry,
      cross_file_context: [
        { file_path: 'src/utils.py', code: 'def helper(): pass' },
        { file_path: 'src/config.py', code: 'CONFIG = {}' },
      ],
    };

    const task = entryToTask(multiEntry, 'python', 0);
    expect(task.expectedFilePaths).toHaveLength(2);
    expect(task.goldSnippets).toHaveLength(2);
  });

  it('should handle entry with no cross-file context', () => {
    const emptyEntry: RepoBenchEntry = {
      ...sampleEntry,
      cross_file_context: [],
    };

    const task = entryToTask(emptyEntry, 'python', 0);
    expect(task.expectedFilePaths).toHaveLength(0);
    expect(task.goldSnippets).toHaveLength(0);
  });
});

// --- buildRetrievalQuery ---

describe('buildRetrievalQuery', () => {
  it('should include language label for Python', () => {
    const query = buildRetrievalQuery(sampleEntry, 'python');
    expect(query).toContain('Python');
    expect(query).not.toContain('Java');
  });

  it('should include language label for Java', () => {
    const query = buildRetrievalQuery(sampleJavaEntry, 'java');
    expect(query).toContain('Java');
    expect(query).not.toContain('Python');
  });

  it('should include the import statement', () => {
    const query = buildRetrievalQuery(sampleEntry, 'python');
    expect(query).toContain('from utils import helper');
  });

  it('should include context preview', () => {
    const query = buildRetrievalQuery(sampleEntry, 'python');
    expect(query).toContain('import numpy');
  });

  it('should truncate very long contexts', () => {
    const longEntry: RepoBenchEntry = {
      ...sampleEntry,
      context: 'x'.repeat(1000),
    };
    const query = buildRetrievalQuery(longEntry, 'python');
    // Should be truncated — full context is 1000 chars
    expect(query.length).toBeLessThan(1000);
  });
});

// --- truncateContext ---

describe('truncateContext', () => {
  it('should return unchanged if within limit', () => {
    expect(truncateContext('short text', 100)).toBe('short text');
  });

  it('should truncate at line boundary when possible', () => {
    const text = 'line1\nline2\nline3\nline4';
    const result = truncateContext(text, 15);
    // Should truncate at a newline and add "..."
    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('should add ellipsis when truncated without good newline', () => {
    const text = 'a'.repeat(100);
    const result = truncateContext(text, 50);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(53); // 50 chars + "..."
  });

  it('should handle empty context', () => {
    expect(truncateContext('', 100)).toBe('');
  });

  it('should handle maxChars of 0', () => {
    const result = truncateContext('some text', 0);
    expect(result).toContain('...');
  });
});

// --- entriesToTasks ---

describe('entriesToTasks', () => {
  it('should convert multiple entries with sequential indices', () => {
    const entries = [sampleEntry, sampleEntry];
    const tasks = entriesToTasks(entries, 'python');

    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.id).toContain('__0');
    expect(tasks[1]?.id).toContain('__1');
    expect(tasks[0]?.language).toBe('python');
    expect(tasks[1]?.language).toBe('python');
  });

  it('should handle empty entries', () => {
    expect(entriesToTasks([], 'python')).toHaveLength(0);
  });
});

// --- tasksToDataset ---

describe('tasksToDataset', () => {
  it('should convert tasks to GenericBenchmarkDataset', () => {
    const tasks = entriesToTasks([sampleEntry], 'python');
    const dataset = tasksToDataset(tasks);

    expect(dataset.queries).toHaveLength(1);
    expect(dataset.queries[0]?.query).toContain('from utils import helper');
    expect(dataset.queries[0]?.expectedChunkIds).toEqual(['src/utils.py']);
    expect(dataset.queries[0]?.context).toBeDefined();
  });

  it('should use custom dataset name', () => {
    const tasks = entriesToTasks([sampleEntry], 'python');
    const dataset = tasksToDataset(tasks, 'custom-name');

    expect((dataset.metadata as Record<string, unknown>)['name']).toBe('custom-name');
  });

  it('should include language metadata', () => {
    const tasks = entriesToTasks([sampleEntry], 'python');
    const dataset = tasksToDataset(tasks);

    const languages = (dataset.metadata as Record<string, unknown>)['languages'];
    expect(languages).toEqual(['python']);
  });

  it('should handle empty tasks', () => {
    const dataset = tasksToDataset([]);
    expect(dataset.queries).toHaveLength(0);
  });
});

// --- convertToDataset ---

describe('convertToDataset', () => {
  it('should convert multi-language entries to combined dataset', () => {
    const entries = new Map([
      ['python' as const, [sampleEntry]],
      ['java' as const, [sampleJavaEntry]],
    ]);

    const dataset = convertToDataset(entries);

    expect(dataset.queries).toHaveLength(2);

    const languages = (dataset.metadata as Record<string, unknown>)['languages'];
    expect(languages).toContain('python');
    expect(languages).toContain('java');
  });

  it('should handle empty map', () => {
    const dataset = convertToDataset(new Map());
    expect(dataset.queries).toHaveLength(0);
  });

  it('should use custom dataset name', () => {
    const entries = new Map([
      ['python' as const, [sampleEntry]],
    ]);

    const dataset = convertToDataset(entries, 'my-dataset');
    expect((dataset.metadata as Record<string, unknown>)['name']).toBe('my-dataset');
  });
});
