import { Command } from 'commander';
import chalk from 'chalk';
import { CodeRAGServer } from '@coderag/mcp-server';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the CodeRAG MCP server')
    .option('--port <port>', 'Port for SSE transport (reserved for future use)')
    .action(async (options: { port?: string }) => {
      try {
        if (options.port) {
          // eslint-disable-next-line no-console
          console.error(chalk.yellow('SSE transport is coming soon. Using stdio transport for now.'));
        }

        const rootDir = process.cwd();

        // eslint-disable-next-line no-console
        console.error(chalk.blue('[coderag]'), 'Starting MCP server (stdio transport)...');

        const server = new CodeRAGServer({ rootDir });
        await server.initialize();

        // Graceful shutdown
        const shutdown = (): void => {
          // eslint-disable-next-line no-console
          console.error(chalk.blue('[coderag]'), 'Shutting down...');
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        await server.connectStdio();

        // eslint-disable-next-line no-console
        console.error(chalk.green('[coderag]'), 'MCP server running on stdio');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('[coderag] Server failed:'), message);
        process.exit(1);
      }
    });
}
