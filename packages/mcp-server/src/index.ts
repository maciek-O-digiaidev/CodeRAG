#!/usr/bin/env node

import { CodeRAGServer } from './server.js';

export { CodeRAGServer, MCP_SERVER_VERSION } from './server.js';
export { handleSearch, searchInputSchema, type SearchInput, type SearchToolResult } from './tools/search.js';
export { handleContext, contextInputSchema, type ContextInput } from './tools/context.js';
export { handleStatus, type StatusResult } from './tools/status.js';

async function main(): Promise<void> {
  const rootDir = process.argv[2] ?? process.cwd();

  const server = new CodeRAGServer({ rootDir });
  await server.initialize();
  await server.connectStdio();
}

// Only run main when this module is executed directly (not imported)
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('/index.ts'));

if (isMainModule) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
