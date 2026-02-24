import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, sep } from 'node:path';
import {
  loadConfig,
  LanceDBStore,
} from '@code-rag/core';

/**
 * Status information about the CodeRAG index.
 */
export interface StatusInfo {
  totalChunks: number;
  model: string;
  dimensions: number;
  languages: string[] | 'auto';
  storagePath: string;
  health: 'ok' | 'degraded' | 'not_initialized';
}

/**
 * Format status info for human-readable terminal output.
 */
export function formatStatus(status: StatusInfo): string {
  const lines: string[] = [];

  lines.push(chalk.bold('CodeRAG Status'));
  lines.push('');

  const healthColor =
    status.health === 'ok'
      ? chalk.green
      : status.health === 'degraded'
        ? chalk.yellow
        : chalk.red;

  lines.push(`  Health:       ${healthColor(status.health)}`);
  lines.push(`  Total chunks: ${chalk.cyan(String(status.totalChunks))}`);
  lines.push(`  Model:        ${chalk.cyan(status.model)}`);
  lines.push(`  Dimensions:   ${chalk.cyan(String(status.dimensions))}`);

  const langDisplay =
    status.languages === 'auto'
      ? 'auto'
      : status.languages.join(', ');
  lines.push(`  Languages:    ${chalk.cyan(langDisplay)}`);
  lines.push(`  Storage:      ${chalk.dim(status.storagePath)}`);

  return lines.join('\n');
}

/**
 * Format status info as JSON.
 */
export function formatStatusJSON(status: StatusInfo): string {
  return JSON.stringify(status, null, 2);
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show the current CodeRAG index status')
    .option('--json', 'Output in JSON format')
    .action(async (options: { json?: boolean }) => {
      try {
        const rootDir = process.cwd();

        // Load config
        const configResult = await loadConfig(rootDir);
        if (configResult.isErr()) {
          const status: StatusInfo = {
            totalChunks: 0,
            model: 'unknown',
            dimensions: 0,
            languages: 'auto',
            storagePath: '',
            health: 'not_initialized',
          };

          if (options.json) {
            // eslint-disable-next-line no-console
            console.log(formatStatusJSON(status));
          } else {
            // eslint-disable-next-line no-console
            console.log(formatStatus(status));
            // eslint-disable-next-line no-console
            console.log('');
            // eslint-disable-next-line no-console
            console.log(chalk.yellow('Run "coderag init" to initialize the project.'));
          }
          return;
        }

        const config = configResult.value;
        const storagePath = resolve(rootDir, config.storage.path);

        // Prevent path traversal outside project root
        if (!storagePath.startsWith(resolve(rootDir) + sep) && storagePath !== resolve(rootDir)) {
          // eslint-disable-next-line no-console
          console.error(chalk.red('Storage path escapes project root'));
          process.exit(1);
        }

        // Connect to LanceDB to get chunk count
        let totalChunks = 0;
        let health: StatusInfo['health'] = 'not_initialized';

        try {
          const store = new LanceDBStore(storagePath, config.embedding.dimensions);
          await store.connect();
          const countResult = await store.count();
          if (countResult.isOk()) {
            totalChunks = countResult.value;
            health = totalChunks > 0 ? 'ok' : 'degraded';
          } else {
            health = 'degraded';
          }
          store.close();
        } catch {
          health = 'degraded';
        }

        const status: StatusInfo = {
          totalChunks,
          model: config.embedding.model,
          dimensions: config.embedding.dimensions,
          languages: config.project.languages,
          storagePath,
          health,
        };

        if (options.json) {
          // eslint-disable-next-line no-console
          console.log(formatStatusJSON(status));
        } else {
          // eslint-disable-next-line no-console
          console.log(formatStatus(status));
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('Status check failed:'), message);
        process.exit(1);
      }
    });
}
