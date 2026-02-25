import { describe, it, expect, vi } from 'vitest';
import {
  evaluateRepoBench,
  generateRepoBenchMarkdownReport,
} from './evaluator.js';
import type { RepoBenchTask } from './types.js';
import type { RepoBenchReport } from './evaluator.js';

// --- Test fixtures ---

const pythonTask: RepoBenchTask = {
  id: 'test__main_py__0',
  query: 'Find Python source for: from utils import helper',
  language: 'python',
  expectedFilePaths: ['src/utils.py'],
  goldSnippets: ['def helper():\n    return 42'],
  repoName: 'test/repo',
  sourceFilePath: 'src/main.py',
};

const javaTask: RepoBenchTask = {
  id: 'test__Main_java__0',
  query: 'Find Java source for: import com.example.Service;',
  language: 'java',
  expectedFilePaths: ['src/Service.java'],
  goldSnippets: ['public class Service {}'],
  repoName: 'test/java-repo',
  sourceFilePath: 'src/Main.java',
};

// --- evaluateRepoBench ---

describe('evaluateRepoBench', () => {
  it('should return error for empty tasks', async () => {
    const retrievalFn = vi.fn(async () => [] as string[]);

    const result = await evaluateRepoBench([], retrievalFn);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('no_tasks');
    }
  });

  it('should evaluate tasks with path-only retrieval', async () => {
    const retrievalFn = vi.fn(async (_query: string) => ['src/utils.py', 'src/other.py']);

    const result = await evaluateRepoBench([pythonTask], retrievalFn);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const report = result.value;

      // Should have evaluation results
      expect(report.evaluation.taskCount).toBe(1);
      expect(report.evaluation.irMetrics.mrr).toBeGreaterThan(0);
      expect(report.evaluation.irMetrics.precisionAt1).toBeGreaterThan(0);

      // Should have task-level results
      expect(report.taskResults).toHaveLength(1);
      expect(report.taskResults[0]?.retrievedPaths).toEqual(['src/utils.py', 'src/other.py']);

      // Should have IR report
      expect(report.irReport.metadata.datasetName).toBe('repobench-r');
    }
  });

  it('should evaluate tasks with snippet retrieval for edit similarity', async () => {
    const retrievalFn = vi.fn(async (_query: string) => ['src/utils.py']);
    const snippetRetrievalFn = vi.fn(async (_query: string) => ({
      paths: ['src/utils.py'] as readonly string[],
      snippets: ['def helper():\n    return 42'] as readonly string[],
    }));

    const result = await evaluateRepoBench([pythonTask], retrievalFn, snippetRetrievalFn);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const report = result.value;

      // With exact matching snippets, edit similarity should be 1.0
      expect(report.evaluation.repobenchMetrics.editSimilarity).toBe(1.0);
      expect(report.evaluation.repobenchMetrics.exactMatch).toBe(1.0);
    }
  });

  it('should compute per-language metrics', async () => {
    const retrievalFn = vi.fn(async (_query: string) => ['src/utils.py', 'src/Service.java']);

    const result = await evaluateRepoBench(
      [pythonTask, javaTask],
      retrievalFn,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const report = result.value;

      expect(report.evaluation.byLanguage.python).toBeDefined();
      expect(report.evaluation.byLanguage.java).toBeDefined();
      expect(report.evaluation.taskCount).toBe(2);
    }
  });

  it('should generate comparison tables', async () => {
    const retrievalFn = vi.fn(async (_query: string) => ['src/utils.py']);

    const result = await evaluateRepoBench([pythonTask], retrievalFn);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(Object.keys(result.value.comparisonTables)).toContain('python');
      expect(result.value.comparisonTables['python']).toContain('CodeRAG');
      expect(result.value.comparisonTables['python']).toContain('BM25');
    }
  });

  it('should handle retrieval returning no results', async () => {
    const retrievalFn = vi.fn(async (_query: string) => [] as string[]);

    const result = await evaluateRepoBench([pythonTask], retrievalFn);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.evaluation.irMetrics.mrr).toBe(0);
      expect(result.value.evaluation.irMetrics.precisionAt1).toBe(0);
    }
  });

  it('should include timestamp in report', async () => {
    const retrievalFn = vi.fn(async (_query: string) => ['src/utils.py']);

    const result = await evaluateRepoBench([pythonTask], retrievalFn);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.timestamp).toBeTruthy();
      // Should be ISO format
      expect(result.value.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

// --- generateRepoBenchMarkdownReport ---

describe('generateRepoBenchMarkdownReport', () => {
  const sampleReport: RepoBenchReport = {
    evaluation: {
      repobenchMetrics: {
        exactMatch: 0.10,
        editSimilarity: 0.45,
      },
      irMetrics: {
        precisionAt1: 0.60,
        precisionAt5: 0.30,
        precisionAt10: 0.20,
        mrr: 0.70,
        ndcgAt10: 0.55,
      },
      taskCount: 50,
      byLanguage: {
        python: { exactMatch: 0.12, editSimilarity: 0.48 },
        java: { exactMatch: 0.08, editSimilarity: 0.42 },
      },
    },
    irReport: {
      perQuery: [],
      aggregate: {
        precisionAt5: 0.30,
        precisionAt10: 0.20,
        recallAt5: 0.25,
        recallAt10: 0.35,
        mrr: 0.70,
        ndcgAt10: 0.55,
        map: 0.40,
        contextPrecision: 0.50,
        contextRecall: null,
      },
      metadata: {
        datasetName: 'repobench-r',
        timestamp: '2024-01-15T10:00:00.000Z',
        queryCount: 50,
      },
    },
    taskResults: [],
    comparisonTables: {
      python: '## RepoBench Comparison -- Python\n| System | EM | ES |\n',
      java: '## RepoBench Comparison -- Java\n| System | EM | ES |\n',
    },
    timestamp: '2024-01-15T10:00:00.000Z',
  };

  it('should generate markdown with title', () => {
    const md = generateRepoBenchMarkdownReport(sampleReport);
    expect(md).toContain('# RepoBench Cross-File Retrieval Evaluation');
  });

  it('should include task count', () => {
    const md = generateRepoBenchMarkdownReport(sampleReport);
    expect(md).toContain('50');
  });

  it('should include RepoBench metrics section', () => {
    const md = generateRepoBenchMarkdownReport(sampleReport);
    expect(md).toContain('## RepoBench Metrics');
    expect(md).toContain('Exact Match');
    expect(md).toContain('Edit Similarity');
    expect(md).toContain('10.0%');
    expect(md).toContain('45.0%');
  });

  it('should include IR metrics section', () => {
    const md = generateRepoBenchMarkdownReport(sampleReport);
    expect(md).toContain('## CodeRAG IR Metrics');
    expect(md).toContain('Precision@1');
    expect(md).toContain('Precision@5');
    expect(md).toContain('MRR');
    expect(md).toContain('nDCG@10');
  });

  it('should include per-language breakdown', () => {
    const md = generateRepoBenchMarkdownReport(sampleReport);
    expect(md).toContain('## Per-Language Breakdown');
    expect(md).toContain('python');
    expect(md).toContain('java');
  });

  it('should include comparison tables', () => {
    const md = generateRepoBenchMarkdownReport(sampleReport);
    expect(md).toContain('RepoBench Comparison');
  });

  it('should include date', () => {
    const md = generateRepoBenchMarkdownReport(sampleReport);
    expect(md).toContain('2024-01-15');
  });
});
