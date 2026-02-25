/**
 * RepoBench to CodeRAG adapter.
 *
 * Converts RepoBench entries into:
 * 1. RepoBenchTask objects for evaluation
 * 2. GenericBenchmarkDataset for the portable IR metrics runner
 *
 * The cross-file-context retrieval task: given code with an import statement,
 * retrieve the file(s) defining the imported symbols.
 */

import type {
  RepoBenchEntry,
  RepoBenchLanguage,
  RepoBenchTask,
} from './types.js';
import type { GenericBenchmarkDataset, GenericBenchmarkQuery } from '../../metrics/types.js';

/**
 * Convert a single RepoBench entry into a RepoBenchTask.
 *
 * The query is constructed from the import statement and leading context,
 * simulating a developer's need to find the definition of an imported symbol.
 *
 * @param entry - Raw RepoBench dataset entry
 * @param language - Source language
 * @param index - Entry index for unique ID generation
 */
export function entryToTask(
  entry: RepoBenchEntry,
  language: RepoBenchLanguage,
  index: number,
): RepoBenchTask {
  const sanitizedRepo = entry.repo_name.replace(/\//g, '_');
  const id = `${sanitizedRepo}__${sanitizeFilePath(entry.file_path)}__${index}`;

  // Build the retrieval query from the import and context
  const query = buildRetrievalQuery(entry, language);

  // Extract expected file paths from cross-file context
  const expectedFilePaths = entry.cross_file_context.map((snippet) => snippet.file_path);

  // Extract gold snippets for edit similarity computation
  const goldSnippets = entry.cross_file_context.map((snippet) => snippet.code);

  return {
    id,
    query,
    language,
    expectedFilePaths,
    goldSnippets,
    repoName: entry.repo_name,
    sourceFilePath: entry.file_path,
  };
}

/**
 * Build a retrieval query from a RepoBench entry.
 *
 * Combines the import statement with a truncated version of the code context
 * to form a natural retrieval query. The import statement is the primary
 * signal for what needs to be retrieved.
 */
export function buildRetrievalQuery(
  entry: RepoBenchEntry,
  language: RepoBenchLanguage,
): string {
  const importLine = entry.import_statement.trim();
  const contextPreview = truncateContext(entry.context, MAX_CONTEXT_CHARS);

  const langLabel = language === 'python' ? 'Python' : 'Java';

  return [
    `Find the ${langLabel} source defining the symbols from:`,
    importLine,
    '',
    'Used in this context:',
    contextPreview,
  ].join('\n');
}

/** Maximum characters of context to include in the query. */
const MAX_CONTEXT_CHARS = 500;

/**
 * Truncate context to a maximum character count, breaking at line boundaries.
 */
export function truncateContext(context: string, maxChars: number): string {
  if (context.length <= maxChars) {
    return context;
  }

  const truncated = context.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline > maxChars * 0.5) {
    return truncated.slice(0, lastNewline) + '\n...';
  }
  return truncated + '...';
}

/**
 * Sanitize a file path for use in an ID string.
 */
function sanitizeFilePath(filePath: string): string {
  return filePath.replace(/[/\\. ]/g, '_');
}

/**
 * Convert multiple RepoBench entries into RepoBenchTasks.
 *
 * @param entries - Raw RepoBench entries
 * @param language - Source language for all entries
 * @returns Array of adapted tasks
 */
export function entriesToTasks(
  entries: readonly RepoBenchEntry[],
  language: RepoBenchLanguage,
): readonly RepoBenchTask[] {
  return entries.map((entry, index) => entryToTask(entry, language, index));
}

/**
 * Convert RepoBench tasks into a GenericBenchmarkDataset.
 *
 * This allows RepoBench evaluation to use the same portable IR metrics
 * runner as all other CodeRAG benchmarks.
 */
export function tasksToDataset(
  tasks: readonly RepoBenchTask[],
  datasetName: string = 'repobench-r',
): GenericBenchmarkDataset {
  const queries: GenericBenchmarkQuery[] = tasks.map((task) => ({
    query: task.query,
    expectedChunkIds: [...task.expectedFilePaths],
    context: task.goldSnippets.join('\n'),
  }));

  return {
    queries,
    metadata: {
      name: datasetName,
      source: 'repobench',
      taskCount: tasks.length,
      languages: [...new Set(tasks.map((t) => t.language))],
    },
  };
}

/**
 * Convert a map of language-specific entries into a combined GenericBenchmarkDataset.
 *
 * @param entriesByLanguage - Map from language to entries
 * @param datasetName - Name for the output dataset
 */
export function convertToDataset(
  entriesByLanguage: ReadonlyMap<RepoBenchLanguage, readonly RepoBenchEntry[]>,
  datasetName: string = 'repobench-r',
): GenericBenchmarkDataset {
  const allTasks: RepoBenchTask[] = [];

  for (const [language, entries] of entriesByLanguage) {
    const tasks = entriesToTasks(entries, language);
    allTasks.push(...tasks);
  }

  return tasksToDataset(allTasks, datasetName);
}
