/**
 * Dashboard Express routes — admin-only, server-rendered HTML.
 */

import { Router, type Request, type Response } from 'express';
import { createAuthMiddleware, requireAdmin, type ApiKeyEntry } from '../middleware/auth.js';
import type { DashboardDataCollector } from './data-collector.js';
import type { IndexTriggerCallback } from '../routes/index-trigger.js';
import type { CodeRAGConfig } from '@coderag/core';
import { renderDashboardPage } from './templates.js';
import type { FlashMessage } from './types.js';

export interface DashboardRouteDeps {
  readonly dataCollector: DashboardDataCollector;
  readonly onIndex: IndexTriggerCallback | null;
  readonly getConfig: () => CodeRAGConfig | null;
  readonly apiKeys: ReadonlyArray<ApiKeyEntry>;
}

/**
 * Create the dashboard router with all admin pages and actions.
 */
export function createDashboardRouter(deps: DashboardRouteDeps): Router {
  const router = Router();

  // Apply auth middleware and requireAdmin to all dashboard routes
  router.use(createAuthMiddleware(deps.apiKeys));
  router.use(requireAdmin);

  // Parse URL-encoded form bodies for POST actions
  router.use((req: Request, _res: Response, next) => {
    if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        // Simple URL-encoded parsing for flash messages
        const params = new URLSearchParams(body);
        (req as Request & { formBody?: Record<string, string> }).formBody = Object.fromEntries(params.entries());
        next();
      });
    } else {
      next();
    }
  });

  // GET /dashboard → redirect to /dashboard/overview
  router.get('/', (_req: Request, res: Response) => {
    res.redirect(302, '/dashboard/overview');
  });

  // GET /dashboard/overview
  router.get('/overview', async (req: Request, res: Response) => {
    try {
      const overview = await deps.dataCollector.getIndexOverview();
      const usageStats = deps.dataCollector.getUsageStats();

      // Read flash from query string (simple approach, no sessions)
      const flash = parseFlash(req);

      const html = renderDashboardPage({
        page: 'overview',
        data: { overview, usageStats, flash },
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).send(`<h1>Internal Server Error</h1><p>${escHtml(message)}</p>`);
    }
  });

  // GET /dashboard/analytics
  router.get('/analytics', (_req: Request, res: Response) => {
    try {
      const analytics = deps.dataCollector.getSearchAnalytics(30);

      const html = renderDashboardPage({
        page: 'analytics',
        data: { analytics },
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).send(`<h1>Internal Server Error</h1><p>${escHtml(message)}</p>`);
    }
  });

  // GET /dashboard/users
  router.get('/users', (_req: Request, res: Response) => {
    try {
      const users = deps.dataCollector.getUsers();

      const html = renderDashboardPage({
        page: 'users',
        data: { users },
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).send(`<h1>Internal Server Error</h1><p>${escHtml(message)}</p>`);
    }
  });

  // GET /dashboard/settings
  router.get('/settings', (_req: Request, res: Response) => {
    try {
      const config = deps.dataCollector.getConfig();
      const coderagConfig = deps.getConfig();

      const projectConfig = coderagConfig
        ? {
            name: coderagConfig.project.name,
            embeddingModel: coderagConfig.embedding.model,
            storagePath: coderagConfig.storage.path,
          }
        : null;

      const html = renderDashboardPage({
        page: 'settings',
        data: { config, projectConfig },
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).send(`<h1>Internal Server Error</h1><p>${escHtml(message)}</p>`);
    }
  });

  // POST /dashboard/actions/reindex
  router.post('/actions/reindex', async (_req: Request, res: Response) => {
    if (!deps.onIndex) {
      res.redirect(302, '/dashboard/overview?flash=error&msg=Indexing+service+not+configured');
      return;
    }

    try {
      const result = await deps.onIndex({ force: true });
      deps.dataCollector.setLastIndexed(new Date().toISOString());

      const msg = encodeURIComponent(
        `Re-indexing completed: ${result.indexed_files} files in ${result.duration_ms}ms`,
      );
      res.redirect(302, `/dashboard/overview?flash=success&msg=${msg}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const msg = encodeURIComponent(`Re-indexing failed: ${message}`);
      res.redirect(302, `/dashboard/overview?flash=error&msg=${msg}`);
    }
  });

  return router;
}

/**
 * Parse a flash message from query parameters.
 */
function parseFlash(req: Request): FlashMessage | undefined {
  const flashType = req.query['flash'];
  const flashMsg = req.query['msg'];

  if (
    typeof flashType === 'string' &&
    typeof flashMsg === 'string' &&
    (flashType === 'success' || flashType === 'error' || flashType === 'info')
  ) {
    return { type: flashType, text: flashMsg };
  }

  return undefined;
}

/**
 * Simple HTML escape for error messages.
 */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
