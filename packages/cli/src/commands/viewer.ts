import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';

export interface ViewerOptions {
  readonly port: number;
  readonly open: boolean;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/**
 * Resolve the viewer dist directory, trying multiple known locations.
 * Returns the absolute path to the dist directory if found, or null.
 */
export function resolveViewerDist(): string | null {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  const candidates = [
    // Relative from compiled CLI dist → viewer dist
    resolve(currentDir, '..', '..', '..', 'viewer', 'dist'),
    // Relative from source → viewer dist
    resolve(currentDir, '..', '..', 'viewer', 'dist'),
    // Monorepo root → viewer dist
    resolve(currentDir, '..', '..', '..', '..', 'packages', 'viewer', 'dist'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return null;
}

/**
 * Serve static files from the viewer dist directory.
 */
async function serveStatic(
  distPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '/';
  const pathname = new URL(url, 'http://localhost').pathname;

  // Map URL path to file path
  let filePath: string;
  if (pathname === '/' || pathname === '') {
    filePath = join(distPath, 'index.html');
  } else {
    filePath = join(distPath, pathname);
  }

  // Security: prevent path traversal
  const normalizedPath = resolve(filePath);
  if (!normalizedPath.startsWith(resolve(distPath))) {
    return false;
  }

  // Check file exists
  if (!existsSync(normalizedPath) || !statSync(normalizedPath).isFile()) {
    return false;
  }

  try {
    const content = await readFile(normalizedPath);
    const ext = normalizedPath.slice(normalizedPath.lastIndexOf('.'));
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the CodeRAG Viewer web interface.
 *
 * Creates an HTTP server that:
 * - Serves static SPA files from the viewer dist directory
 * - Proxies /api/* requests to the CodeRAG API server
 * - Falls back to index.html for SPA client-side routing
 */
export async function viewerCommand(options: ViewerOptions): Promise<void> {
  const distPath = resolveViewerDist();
  if (!distPath) {
    // eslint-disable-next-line no-console
    console.error(
      chalk.red('[coderag]'),
      'Viewer not built. Run',
      chalk.cyan('pnpm --filter @code-rag/viewer build'),
      'first.',
    );
    process.exit(1);
  }

  const { port } = options;

  // Dynamically import the API server (only if available).
  // Express apps implement the Node.js HTTP request handler signature, so we
  // store the handler with that generic type to avoid needing @types/express.
  type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void;
  let apiHandler: HttpHandler | null = null;
  try {
    const { ApiServer } = await import('@code-rag/api-server');
    const rootDir = process.cwd();
    const apiServer = new ApiServer({ rootDir, port: port + 1 });
    await apiServer.initialize();
    // Express app is a callable (req, res) => void handler by design
    const app: unknown = apiServer.getApp();
    if (typeof app === 'function') {
      apiHandler = app as HttpHandler;
    }
    // eslint-disable-next-line no-console
    console.error(chalk.blue('[coderag]'), 'API server initialized');
  } catch {
    // eslint-disable-next-line no-console
    console.error(
      chalk.yellow('[coderag]'),
      'API server not available. Viewer will serve static files only.',
    );
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';

    // Route /api/* to the API server if available
    if (url.startsWith('/api/') || url === '/health') {
      if (apiHandler) {
        apiHandler(req, res);
        return;
      }
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API server not available' }));
      return;
    }

    // Try to serve static file
    const served = await serveStatic(distPath, req, res);
    if (served) return;

    // SPA fallback: serve index.html for client-side routing
    const indexPath = join(distPath, 'index.html');
    if (existsSync(indexPath)) {
      try {
        const content = await readFile(indexPath);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': content.length,
          'Cache-Control': 'no-cache',
        });
        res.end(content);
        return;
      } catch {
        // Fall through to 404
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // Graceful shutdown
  const shutdown = (): void => {
    // eslint-disable-next-line no-console
    console.error(chalk.blue('\n[coderag]'), 'Shutting down viewer...');
    server.close(() => {
      process.exit(0);
    });
    // Force exit after 5s if graceful close hangs
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start listening
  await new Promise<void>((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      resolvePromise();
    });
  });

  const url = `http://localhost:${port}`;
  // eslint-disable-next-line no-console
  console.error(chalk.green('[coderag]'), `Viewer running at ${chalk.cyan(url)}`);

  // Open browser if requested
  if (options.open) {
    try {
      const { exec } = await import('node:child_process');
      const openCmd =
        process.platform === 'darwin' ? 'open' :
        process.platform === 'win32' ? 'start' :
        'xdg-open';
      exec(`${openCmd} ${url}`);
    } catch {
      // Silently ignore if browser cannot be opened
    }
  }
}

export function registerViewerCommand(program: Command): void {
  program
    .command('viewer')
    .description('Launch the CodeRAG Viewer web interface')
    .option('-p, --port <port>', 'Port number', '3333')
    .option('--no-open', 'Do not open browser automatically')
    .action(async (opts: { port: string; open: boolean }) => {
      await viewerCommand({
        port: parseInt(opts.port, 10),
        open: opts.open !== false,
      });
    });
}
