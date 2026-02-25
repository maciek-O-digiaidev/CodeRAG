import { Command } from 'commander';
import chalk from 'chalk';
import {
  createRuntime,
  type SearchResult,
} from '@code-rag/core';

/**
 * Format a single search result for terminal display.
 */
export function formatSearchResult(result: SearchResult, index: number): string {
  const lines: string[] = [];
  const rank = chalk.dim(`[${index + 1}]`);
  const score = chalk.green(result.score.toFixed(4));
  const filePath = chalk.cyan(result.chunk?.filePath ?? result.metadata.name ?? 'unknown');
  const chunkType = chalk.magenta(result.metadata.chunkType);

  let lineRange = '';
  if (result.chunk && result.chunk.startLine > 0) {
    lineRange = chalk.dim(` L${result.chunk.startLine}-${result.chunk.endLine}`);
  }

  lines.push(`${rank} ${filePath}${lineRange}  ${chunkType}  score: ${score}`);

  if (result.nlSummary) {
    lines.push(`    ${chalk.dim(result.nlSummary)}`);
  }

  return lines.join('\n');
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search the indexed codebase')
    .argument('<query>', 'Search query')
    .option('--language <lang>', 'Filter by programming language')
    .option('--type <chunkType>', 'Filter by chunk type (function, class, method, etc.)')
    .option('--file <path>', 'Filter by file path substring')
    .option('--top-k <n>', 'Maximum number of results', '10')
    .action(async (query: string, options: { language?: string; type?: string; file?: string; topK: string }) => {
      try {
        const rootDir = process.cwd();
        const topK = parseInt(options.topK, 10);

        if (isNaN(topK) || topK < 1) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('Invalid --top-k value. Must be a positive integer.'));
          process.exit(1);
        }

        // Initialize runtime (search-only mode: skip graph, reranker, context expander)
        const runtimeResult = await createRuntime({ rootDir, searchOnly: true });
        if (runtimeResult.isErr()) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('Initialization failed.'), runtimeResult.error.message);
          process.exit(1);
        }
        const runtime = runtimeResult.value;

        // Run search
        const searchResult = await runtime.hybridSearch.search(query, { topK });
        if (searchResult.isErr()) {
          runtime.close();
          // eslint-disable-next-line no-console
          console.error(chalk.red('Search failed:'), searchResult.error.message);
          process.exit(1);
        }

        let results = searchResult.value;

        // Apply filters
        if (options.language) {
          const lang = options.language.toLowerCase();
          results = results.filter(
            (r) => r.chunk?.language?.toLowerCase() === lang,
          );
        }
        if (options.type) {
          const chunkType = options.type.toLowerCase();
          results = results.filter(
            (r) => r.metadata.chunkType.toLowerCase() === chunkType,
          );
        }
        if (options.file) {
          const fileFilter = options.file.toLowerCase();
          results = results.filter(
            (r) => (r.chunk?.filePath ?? '').toLowerCase().includes(fileFilter),
          );
        }

        runtime.close();

        // Display results
        if (results.length === 0) {
          // eslint-disable-next-line no-console
          console.log(chalk.yellow('No results found.'));
          return;
        }

        // eslint-disable-next-line no-console
        console.log(chalk.bold(`Found ${results.length} result(s) for "${query}":\n`));
        for (let i = 0; i < results.length; i++) {
          const result = results[i]!;
          // eslint-disable-next-line no-console
          console.log(formatSearchResult(result, i));
          if (i < results.length - 1) {
            // eslint-disable-next-line no-console
            console.log('');
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('Search failed:'), message);
        process.exit(1);
      }
    });
}
