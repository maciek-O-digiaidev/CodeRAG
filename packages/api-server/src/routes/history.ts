import { Router } from 'express';
import { z } from 'zod';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuthenticatedRequest } from '../middleware/auth.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const historyEntrySchema = z.object({
  query: z.string().min(1, 'query must not be empty'),
  filters: z.record(z.string(), z.unknown()).optional(),
  results_count: z.number().int().nonnegative().optional(),
});

export type HistoryEntryInput = z.infer<typeof historyEntrySchema>;

export const bookmarkSchema = z.object({
  name: z.string().min(1, 'name must not be empty'),
  query: z.string().min(1, 'query must not be empty'),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export type BookmarkInput = z.infer<typeof bookmarkSchema>;

// ---------------------------------------------------------------------------
// Stored data types
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  readonly id: string;
  readonly userId: string;
  readonly query: string;
  readonly filters: Record<string, unknown>;
  readonly resultsCount: number;
  readonly timestamp: Date;
}

export interface Bookmark {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly query: string;
  readonly filters: Record<string, unknown>;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// In-memory store with JSONL persistence
// ---------------------------------------------------------------------------

export class HistoryStore {
  private readonly history: HistoryEntry[] = [];
  private readonly bookmarks: Bookmark[] = [];
  private nextHistoryId = 1;
  private nextBookmarkId = 1;
  private readonly historyFilePath: string | undefined;
  private readonly bookmarkFilePath: string | undefined;

  constructor(historyFilePath?: string, bookmarkFilePath?: string) {
    this.historyFilePath = historyFilePath;
    this.bookmarkFilePath = bookmarkFilePath;

    // Load existing data
    if (historyFilePath && existsSync(historyFilePath)) {
      try {
        const raw = readFileSync(historyFilePath, 'utf-8');
        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
          const parsed = JSON.parse(line) as {
            id: string;
            userId: string;
            query: string;
            filters: Record<string, unknown>;
            resultsCount: number;
            timestamp: string;
          };
          const entry: HistoryEntry = {
            ...parsed,
            timestamp: new Date(parsed.timestamp),
          };
          this.history.push(entry);
          const idNum = parseInt(parsed.id.replace('hist-', ''), 10);
          if (!isNaN(idNum) && idNum >= this.nextHistoryId) {
            this.nextHistoryId = idNum + 1;
          }
        }
      } catch {
        // Corrupt file — start fresh in-memory
      }
    }

    if (bookmarkFilePath && existsSync(bookmarkFilePath)) {
      try {
        const raw = readFileSync(bookmarkFilePath, 'utf-8');
        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
          const parsed = JSON.parse(line) as {
            id: string;
            userId: string;
            name: string;
            query: string;
            filters: Record<string, unknown>;
            createdAt: string;
          };
          const bookmark: Bookmark = {
            ...parsed,
            createdAt: new Date(parsed.createdAt),
          };
          this.bookmarks.push(bookmark);
          const idNum = parseInt(parsed.id.replace('bm-', ''), 10);
          if (!isNaN(idNum) && idNum >= this.nextBookmarkId) {
            this.nextBookmarkId = idNum + 1;
          }
        }
      } catch {
        // Corrupt file — start fresh
      }
    }
  }

  // -----------------------------------------------------------------------
  // History operations
  // -----------------------------------------------------------------------

  addHistory(userId: string, input: HistoryEntryInput): HistoryEntry {
    const entry: HistoryEntry = {
      id: `hist-${this.nextHistoryId++}`,
      userId,
      query: input.query,
      filters: input.filters ?? {},
      resultsCount: input.results_count ?? 0,
      timestamp: new Date(),
    };

    this.history.push(entry);
    this.persistHistoryEntry(entry);
    return entry;
  }

  getHistory(userId: string, page = 1, pageSize = 20): {
    items: readonly HistoryEntry[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const userEntries = this.history
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const start = (page - 1) * pageSize;
    const items = userEntries.slice(start, start + pageSize);

    return {
      items,
      total: userEntries.length,
      page,
      pageSize,
    };
  }

  deleteHistory(userId: string, id: string): boolean {
    const index = this.history.findIndex(
      (e) => e.id === id && e.userId === userId,
    );
    if (index === -1) return false;
    this.history.splice(index, 1);
    return true;
  }

  // -----------------------------------------------------------------------
  // Bookmark operations
  // -----------------------------------------------------------------------

  addBookmark(userId: string, input: BookmarkInput): Bookmark {
    const bookmark: Bookmark = {
      id: `bm-${this.nextBookmarkId++}`,
      userId,
      name: input.name,
      query: input.query,
      filters: input.filters ?? {},
      createdAt: new Date(),
    };

    this.bookmarks.push(bookmark);
    this.persistBookmarkEntry(bookmark);
    return bookmark;
  }

  getBookmarks(userId: string): readonly Bookmark[] {
    return this.bookmarks
      .filter((b) => b.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  deleteBookmark(userId: string, id: string): boolean {
    const index = this.bookmarks.findIndex(
      (b) => b.id === id && b.userId === userId,
    );
    if (index === -1) return false;
    this.bookmarks.splice(index, 1);
    return true;
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  private persistHistoryEntry(entry: HistoryEntry): void {
    if (!this.historyFilePath) return;
    try {
      const dir = dirname(this.historyFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const line = JSON.stringify({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      });
      appendFileSync(this.historyFilePath, line + '\n');
    } catch {
      // Swallow I/O errors
    }
  }

  private persistBookmarkEntry(bookmark: Bookmark): void {
    if (!this.bookmarkFilePath) return;
    try {
      const dir = dirname(this.bookmarkFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const line = JSON.stringify({
        ...bookmark,
        createdAt: bookmark.createdAt.toISOString(),
      });
      appendFileSync(this.bookmarkFilePath, line + '\n');
    } catch {
      // Swallow I/O errors
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(req: AuthenticatedRequest): string {
  // Use apiKey identifier, X-User-Id header, or 'anonymous'
  const userHeader = req.headers['x-user-id'];
  if (typeof userHeader === 'string' && userHeader.trim().length > 0) {
    return userHeader.trim();
  }
  if (req.apiKey) {
    return req.apiKey.key.slice(0, 8); // Use first 8 chars of API key as user ID
  }
  return 'anonymous';
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface HistoryRouteDeps {
  readonly historyStore: HistoryStore;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createHistoryRouter(deps: HistoryRouteDeps): Router {
  const router = Router();

  // GET /api/v1/history — list user's query history (paginated)
  router.get('/history', (req, res) => {
    const userId = getUserId(req as AuthenticatedRequest);
    const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query['page_size'] as string, 10) || 20));

    const result = deps.historyStore.getHistory(userId, page, pageSize);

    res.status(200).json({
      items: result.items.map(formatHistoryEntry),
      total: result.total,
      page: result.page,
      page_size: result.pageSize,
    });
  });

  // POST /api/v1/history — record a query in history
  router.post('/history', (req, res) => {
    const parsed = historyEntrySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    const userId = getUserId(req as AuthenticatedRequest);
    const entry = deps.historyStore.addHistory(userId, parsed.data);

    res.status(201).json(formatHistoryEntry(entry));
  });

  // DELETE /api/v1/history/:id — delete history entry
  router.delete('/history/:id', (req, res) => {
    const userId = getUserId(req as AuthenticatedRequest);
    const id = req.params['id'];

    if (!id) {
      res.status(400).json({ error: 'Missing id parameter' });
      return;
    }

    const deleted = deps.historyStore.deleteHistory(userId, id);

    if (!deleted) {
      res.status(404).json({
        error: 'Not Found',
        message: `History entry "${id}" not found.`,
      });
      return;
    }

    res.status(204).end();
  });

  // GET /api/v1/bookmarks — list bookmarks
  router.get('/bookmarks', (req, res) => {
    const userId = getUserId(req as AuthenticatedRequest);
    const bookmarks = deps.historyStore.getBookmarks(userId);

    res.status(200).json({
      items: bookmarks.map(formatBookmark),
      total: bookmarks.length,
    });
  });

  // POST /api/v1/bookmarks — add bookmark
  router.post('/bookmarks', (req, res) => {
    const parsed = bookmarkSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues,
      });
      return;
    }

    const userId = getUserId(req as AuthenticatedRequest);
    const bookmark = deps.historyStore.addBookmark(userId, parsed.data);

    res.status(201).json(formatBookmark(bookmark));
  });

  // DELETE /api/v1/bookmarks/:id — remove bookmark
  router.delete('/bookmarks/:id', (req, res) => {
    const userId = getUserId(req as AuthenticatedRequest);
    const id = req.params['id'];

    if (!id) {
      res.status(400).json({ error: 'Missing id parameter' });
      return;
    }

    const deleted = deps.historyStore.deleteBookmark(userId, id);

    if (!deleted) {
      res.status(404).json({
        error: 'Not Found',
        message: `Bookmark "${id}" not found.`,
      });
      return;
    }

    res.status(204).end();
  });

  return router;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatHistoryEntry(entry: HistoryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    user_id: entry.userId,
    query: entry.query,
    filters: entry.filters,
    results_count: entry.resultsCount,
    timestamp: entry.timestamp.toISOString(),
  };
}

function formatBookmark(bookmark: Bookmark): Record<string, unknown> {
  return {
    id: bookmark.id,
    user_id: bookmark.userId,
    name: bookmark.name,
    query: bookmark.query,
    filters: bookmark.filters,
    created_at: bookmark.createdAt.toISOString(),
  };
}
