import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';

export const indexTriggerRequestSchema = z.object({
  root_dir: z.string().min(1, 'root_dir must not be empty').refine(
    (s) => !s.includes('..'),
    'root_dir must not contain path traversal',
  ).optional(),
  force: z.boolean().optional().default(false),
});

export type IndexTriggerRequest = z.infer<typeof indexTriggerRequestSchema>;

/**
 * Callback invoked when re-indexing is triggered via the API.
 */
export type IndexTriggerCallback = (options: {
  rootDir?: string;
  force: boolean;
}) => Promise<{ indexed_files: number; duration_ms: number }>;

export interface IndexTriggerRouteDeps {
  readonly onIndex: IndexTriggerCallback | null;
}

export function createIndexTriggerRouter(deps: IndexTriggerRouteDeps): Router {
  const router = Router();

  // Admin-only endpoint
  router.post('/', requireAdmin, async (req, res) => {
    const parsed = indexTriggerRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    if (!deps.onIndex) {
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Indexing service not configured.',
      });
      return;
    }

    try {
      const result = await deps.onIndex({
        rootDir: parsed.data.root_dir,
        force: parsed.data.force,
      });

      res.json({
        status: 'completed',
        indexed_files: result.indexed_files,
        duration_ms: result.duration_ms,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        error: 'Indexing Failed',
        message,
      });
    }
  });

  return router;
}
