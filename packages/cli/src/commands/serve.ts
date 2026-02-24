import { Command } from 'commander';
import chalk from 'chalk';
import { CodeRAGServer, NO_INDEX_MESSAGE } from '@code-rag/mcp-server';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the CodeRAG MCP server')
    .option('--port <port>', 'Port for SSE transport')
    .action(async (options: { port?: string }) => {
      try {
        const rootDir = process.cwd();
        const server = new CodeRAGServer({ rootDir });

        // Guard: check if index exists before starting the server
        const indexCheck = await server.checkIndex();
        if (indexCheck !== null && !indexCheck.exists) {
          // eslint-disable-next-line no-console
          console.error(chalk.yellow(NO_INDEX_MESSAGE));
          process.exit(1);
        }

        await server.initialize();

        // Graceful shutdown
        const shutdown = (): void => {
          // eslint-disable-next-line no-console
          console.error(chalk.blue('[coderag]'), 'Shutting down...');
          server.close().finally(() => process.exit(0));
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        if (options.port) {
          const port = parseInt(options.port, 10);
          if (isNaN(port) || port < 1 || port > 65535) {
            // eslint-disable-next-line no-console
            console.error(chalk.red('[coderag] Invalid port number'));
            process.exit(1);
          }
          // eslint-disable-next-line no-console
          console.error(chalk.blue('[coderag]'), `Starting MCP server (SSE transport on port ${port})...`);
          await server.connectSSE(port);
          // eslint-disable-next-line no-console
          console.error(chalk.green('[coderag]'), `MCP server running on http://localhost:${port}/sse`);
        } else {
          // eslint-disable-next-line no-console
          console.error(chalk.blue('[coderag]'), 'Starting MCP server (stdio transport)...');
          await server.connectStdio();
          // eslint-disable-next-line no-console
          console.error(chalk.green('[coderag]'), 'MCP server running on stdio');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(chalk.red('[coderag] Server failed:'), message);
        process.exit(1);
      }
    });
}
