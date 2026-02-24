import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import {
  loadConfig,
  createIgnoreFilter,
  FileWatcher,
} from '@coderag/core';

/**
 * Register the `coderag watch` CLI command.
 *
 * Starts a file watcher that monitors the project directory for changes
 * and triggers incremental re-indexing on each debounced batch.
 */
export function registerWatchCommand(program: Command): void {
  program
    .command('watch')
    .description('Watch the codebase for changes and trigger incremental re-indexing')
    .option('--debounce <ms>', 'Debounce window in milliseconds', '2000')
    .action(async (options: { debounce: string }) => {
      const debounceMs = parseInt(options.debounce, 10);
      if (isNaN(debounceMs) || debounceMs < 0) {
        // eslint-disable-next-line no-console
        console.error(chalk.red('Invalid debounce value. Must be a non-negative integer.'));
        process.exit(1);
      }

      const spinner = ora('Loading configuration...').start();

      try {
        const rootDir = process.cwd();

        // Load config
        const configResult = await loadConfig(rootDir);
        if (configResult.isErr()) {
          spinner.fail(configResult.error.message);
          // eslint-disable-next-line no-console
          console.error(chalk.red('Run "coderag init" first to create a configuration file.'));
          process.exit(1);
        }
        const config = configResult.value;
        const storagePath = resolve(rootDir, config.storage.path);

        // Prevent path traversal outside project root
        if (!storagePath.startsWith(resolve(rootDir) + sep) && storagePath !== resolve(rootDir)) {
          spinner.fail('Storage path escapes project root');
          process.exit(1);
        }

        // Create ignore filter
        const ignoreFilter = createIgnoreFilter(rootDir);

        // Create and start file watcher
        const watcher = new FileWatcher({
          rootDir,
          ignoreFilter,
          debounceMs,
        });

        let isIndexing = false;
        let indexCount = 0;

        watcher.on('change', (changedPaths) => {
          if (isIndexing) {
            // eslint-disable-next-line no-console
            console.log(chalk.yellow(`  Skipping batch (${changedPaths.length} files) — indexing already in progress`));
            return;
          }

          isIndexing = true;
          indexCount++;
          const batchNum = indexCount;

          // eslint-disable-next-line no-console
          console.log('');
          // eslint-disable-next-line no-console
          console.log(chalk.bold(`[Batch ${batchNum}] ${changedPaths.length} file(s) changed:`));
          for (const filePath of changedPaths.slice(0, 10)) {
            // eslint-disable-next-line no-console
            console.log(`  ${chalk.gray('→')} ${filePath}`);
          }
          if (changedPaths.length > 10) {
            // eslint-disable-next-line no-console
            console.log(`  ${chalk.gray(`… and ${changedPaths.length - 10} more`)}`);
          }

          // eslint-disable-next-line no-console
          console.log(chalk.cyan('  Running incremental index...'));

          const startTime = Date.now();

          const child = spawn(
            process.execPath,
            [process.argv[1]!, 'index'],
            {
              cwd: rootDir,
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );

          child.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().trimEnd().split('\n');
            for (const line of lines) {
              // eslint-disable-next-line no-console
              console.log(`  ${chalk.gray('│')} ${line}`);
            }
          });

          child.stderr.on('data', (data: Buffer) => {
            const lines = data.toString().trimEnd().split('\n');
            for (const line of lines) {
              // eslint-disable-next-line no-console
              console.log(`  ${chalk.gray('│')} ${chalk.yellow(line)}`);
            }
          });

          child.on('close', (code) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            if (code === 0) {
              // eslint-disable-next-line no-console
              console.log(chalk.green(`  Batch ${batchNum} complete (${elapsed}s)`));
            } else {
              // eslint-disable-next-line no-console
              console.log(chalk.red(`  Batch ${batchNum} failed with exit code ${code ?? 'unknown'} (${elapsed}s)`));
            }
            isIndexing = false;
          });

          child.on('error', (err: Error) => {
            // eslint-disable-next-line no-console
            console.log(chalk.red(`  Batch ${batchNum} spawn error: ${err.message}`));
            isIndexing = false;
          });
        });

        watcher.on('error', (error) => {
          // eslint-disable-next-line no-console
          console.error(chalk.red(`Watcher error: ${error.message}`));
        });

        spinner.succeed('Configuration loaded');
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log(chalk.bold('CodeRAG File Watcher'));
        // eslint-disable-next-line no-console
        console.log(`  Root:     ${chalk.cyan(rootDir)}`);
        // eslint-disable-next-line no-console
        console.log(`  Debounce: ${chalk.cyan(debounceMs + 'ms')}`);
        // eslint-disable-next-line no-console
        console.log(`  Storage:  ${chalk.cyan(storagePath)}`);
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log(chalk.gray('Watching for file changes... (press Ctrl+C to stop)'));

        await watcher.start();

        // Handle graceful shutdown
        const shutdown = async (): Promise<void> => {
          // eslint-disable-next-line no-console
          console.log('');
          // eslint-disable-next-line no-console
          console.log(chalk.yellow('Stopping watcher...'));
          await watcher.stop();
          // eslint-disable-next-line no-console
          console.log(chalk.green(`Watcher stopped. Processed ${indexCount} batch(es).`));
          process.exit(0);
        };

        process.on('SIGINT', () => void shutdown());
        process.on('SIGTERM', () => void shutdown());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        spinner.fail(`Watch failed: ${message}`);
        process.exit(1);
      }
    });
}
