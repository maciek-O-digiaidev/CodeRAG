import { Router } from 'express';
import { z } from 'zod';
import type { CloudStorageProvider } from '@code-rag/core';
import { StorageError } from '@code-rag/core';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const connectRequestSchema = z.object({
  provider: z.enum(['s3', 'azure-blob', 'gcs']),
  bucket: z.string().min(1, 'bucket must not be empty').optional(),
  container: z.string().min(1, 'container must not be empty').optional(),
  region: z.string().optional(),
  team_id: z.string().min(1, 'team_id must not be empty'),
});

export type ConnectRequest = z.infer<typeof connectRequestSchema>;

export const syncRequestSchema = z.object({
  force: z.boolean().optional().default(false),
});

export type SyncRequest = z.infer<typeof syncRequestSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ConnectResponse {
  readonly status: 'connected';
  readonly team_id: string;
  readonly provider: string;
  readonly connected_at: string;
}

export interface AnalyticsResponse {
  readonly top_queries: ReadonlyArray<{ query: string; count: number }>;
  readonly coverage_gaps: ReadonlyArray<{ file_path: string; reason: string }>;
  readonly total_queries: number;
  readonly unique_users: number;
}

export interface SyncResponse {
  readonly status: 'synced' | 'failed';
  readonly files_synced: number;
  readonly duration_ms: number;
}

// ---------------------------------------------------------------------------
// In-memory team state
// ---------------------------------------------------------------------------

export interface TeamConnection {
  readonly teamId: string;
  readonly provider: string;
  readonly connectedAt: Date;
}

export interface QueryRecord {
  readonly query: string;
  readonly userId: string;
  readonly timestamp: Date;
}

export interface TeamState {
  connections: Map<string, TeamConnection>;
  queryLog: QueryRecord[];
}

export function createTeamState(): TeamState {
  return {
    connections: new Map(),
    queryLog: [],
  };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface TeamRouteDeps {
  readonly storageProvider: CloudStorageProvider | null;
  readonly teamState: TeamState;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createTeamRouter(deps: TeamRouteDeps): Router {
  const router = Router();

  // POST /api/v1/team/connect — connect CLI to cloud index
  router.post('/connect', (req, res) => {
    const parsed = connectRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    const { provider, team_id } = parsed.data;

    const connection: TeamConnection = {
      teamId: team_id,
      provider,
      connectedAt: new Date(),
    };

    deps.teamState.connections.set(team_id, connection);

    const response: ConnectResponse = {
      status: 'connected',
      team_id,
      provider,
      connected_at: connection.connectedAt.toISOString(),
    };

    res.status(200).json(response);
  });

  // GET /api/v1/team/analytics — team-level analytics
  router.get('/analytics', (_req, res) => {
    const queryLog = deps.teamState.queryLog;

    // Most searched queries
    const queryCounts = new Map<string, number>();
    const uniqueUsers = new Set<string>();

    for (const record of queryLog) {
      const current = queryCounts.get(record.query) ?? 0;
      queryCounts.set(record.query, current + 1);
      uniqueUsers.add(record.userId);
    }

    const topQueries = [...queryCounts.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Coverage gaps: files that were searched for but not found
    // For now, return empty since we'd need index data to determine gaps
    const coverageGaps: Array<{ file_path: string; reason: string }> = [];

    const response: AnalyticsResponse = {
      top_queries: topQueries,
      coverage_gaps: coverageGaps,
      total_queries: queryLog.length,
      unique_users: uniqueUsers.size,
    };

    res.status(200).json(response);
  });

  // POST /api/v1/team/sync — trigger index sync to cloud storage
  router.post('/sync', async (req, res) => {
    const parsed = syncRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    if (!deps.storageProvider) {
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Cloud storage provider not configured. Connect to a team first.',
      });
      return;
    }

    try {
      const startTime = Date.now();

      // Upload a sync marker to verify connectivity
      const syncMarker = Buffer.from(JSON.stringify({
        synced_at: new Date().toISOString(),
        force: parsed.data.force,
      }));

      const uploadResult = await deps.storageProvider.upload(
        'sync/latest.json',
        syncMarker,
      );

      if (uploadResult.isErr()) {
        const syncError = uploadResult.error;
        res.status(500).json({
          error: 'Sync Failed',
          message: syncError instanceof StorageError ? syncError.message : 'Unknown storage error',
        });
        return;
      }

      const durationMs = Date.now() - startTime;

      const response: SyncResponse = {
        status: 'synced',
        files_synced: 1,
        duration_ms: durationMs,
      };

      res.status(200).json(response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        error: 'Sync Failed',
        message,
      });
    }
  });

  return router;
}
