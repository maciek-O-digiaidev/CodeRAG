#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { CodeRAGServer } from './server.js';

export { CodeRAGServer, MCP_SERVER_VERSION } from './server.js';
export { handleSearch, searchInputSchema, type SearchInput, type SearchToolResult } from './tools/search.js';
export { handleContext, contextInputSchema, type ContextInput } from './tools/context.js';
export { handleStatus, type StatusResult } from './tools/status.js';
export { handleExplain, explainInputSchema, type ExplainInput } from './tools/explain.js';
export { handleBacklog, backlogInputSchema, type BacklogInput } from './tools/backlog.js';
export { handleDocs, docsInputSchema, type DocsInput, type DocsToolResult } from './tools/docs.js';

async function main(): Promise<void> {
  const rootDir = process.argv[2] ?? process.cwd();

  const server = new CodeRAGServer({ rootDir });
  await server.initialize();
  await server.connectStdio();
}

// Only run main when this module is executed directly (not imported)
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
