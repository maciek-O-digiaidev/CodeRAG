#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { ApiServer } from './server.js';

export { ApiServer, API_SERVER_VERSION } from './server.js';
export type { ApiServerOptions } from './server.js';

export { parseApiKeys, createAuthMiddleware, requireAdmin } from './middleware/auth.js';
export type { ApiKeyEntry, AuthenticatedRequest } from './middleware/auth.js';

export { createRateLimitMiddleware, parseRateLimitConfig } from './middleware/rate-limit.js';
export type { RateLimitConfig } from './middleware/rate-limit.js';

export { createSearchRouter, searchRequestSchema } from './routes/search.js';
export type { SearchRequest, SearchResponseItem, SearchRouteDeps } from './routes/search.js';

export { createContextRouter, contextRequestSchema } from './routes/context.js';
export type { ContextRequest, ContextRouteDeps } from './routes/context.js';

export { createStatusRouter } from './routes/status.js';
export type { StatusResponse, StatusRouteDeps } from './routes/status.js';

export { createIndexTriggerRouter, indexTriggerRequestSchema } from './routes/index-trigger.js';
export type { IndexTriggerRequest, IndexTriggerCallback, IndexTriggerRouteDeps } from './routes/index-trigger.js';

export { createOpenAPISpec } from './openapi.js';
export type { OpenAPISpec } from './openapi.js';

export { createViewerRouter } from './routes/viewer.js';
export type {
  ViewerDeps,
  ViewerStatsResponse,
  ChunkSummary,
  ChunkDetail,
  PaginationMeta,
  GraphResponse,
  ViewerSearchResult,
  ViewerSearchResponse,
  EmbeddingPoint,
} from './routes/viewer.js';

export { DashboardDataCollector, createDashboardRouter, renderDashboardPage, esc } from './dashboard/index.js';
export type {
  DashboardDataCollectorDeps,
  DashboardRouteDeps,
  OverviewPageData,
  AnalyticsPageData,
  UsersPageData,
  SettingsPageData,
  PageData,
  IndexOverview,
  SearchAnalytics,
  UserInfo,
  UsageStats,
  DashboardConfig,
  DashboardPage,
  FlashMessage,
  DailyQueryCount,
  TopQuery,
  SearchRecord,
  RequestRecord,
} from './dashboard/index.js';

const DEFAULT_PORT = 3100;

async function main(): Promise<void> {
  const rootDir = process.argv[2] ?? process.cwd();
  const port = parseInt(process.env['CODERAG_PORT'] ?? '', 10) || DEFAULT_PORT;

  const server = new ApiServer({ rootDir, port });
  await server.initialize();
  await server.start();

  // eslint-disable-next-line no-console
  console.log(`[api-server] CodeRAG API server listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[api-server] OpenAPI spec: http://localhost:${port}/api/openapi.json`);
  // eslint-disable-next-line no-console
  console.log(`[api-server] Health check: http://localhost:${port}/health`);
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
