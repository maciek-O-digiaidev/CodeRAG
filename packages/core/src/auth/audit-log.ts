import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry, AuditQuery } from './types.js';

// ---------------------------------------------------------------------------
// AuditLogger
// ---------------------------------------------------------------------------

/**
 * Records and queries audit entries for who-searched-what-when tracking.
 *
 * Entries are stored in-memory for fast access.  When `filePath` is provided,
 * entries are also **appended** to a JSON-lines (.jsonl) file for persistence
 * across restarts.
 */
export class AuditLogger {
  private readonly entries: AuditEntry[] = [];
  private readonly filePath: string | undefined;

  constructor(filePath?: string) {
    this.filePath = filePath;

    // Load existing entries from file on startup
    if (filePath && existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
          const parsed = JSON.parse(line) as {
            timestamp: string;
            userId: string;
            action: string;
            resource: string;
            details: string;
            ip: string;
          };
          this.entries.push({
            ...parsed,
            timestamp: new Date(parsed.timestamp),
          });
        }
      } catch {
        // If file is corrupt we start fresh in-memory
      }
    }
  }

  // -----------------------------------------------------------------------
  // Write
  // -----------------------------------------------------------------------

  /**
   * Records an audit entry.  Appends to the in-memory list and, if configured,
   * to the on-disk JSON-lines file.
   */
  log(entry: AuditEntry): void {
    this.entries.push(entry);

    if (this.filePath) {
      try {
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        const line = JSON.stringify({
          ...entry,
          timestamp: entry.timestamp.toISOString(),
        });
        appendFileSync(this.filePath, line + '\n');
      } catch {
        // Swallow I/O errors — audit should not break the main flow
      }
    }
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Searches audit entries matching the given filters.  Returns results in
   * reverse-chronological order (newest first).
   */
  query(filters: AuditQuery): readonly AuditEntry[] {
    let results = [...this.entries];

    if (filters.userId) {
      results = results.filter((e) => e.userId === filters.userId);
    }

    if (filters.action) {
      results = results.filter((e) => e.action === filters.action);
    }

    if (filters.startDate) {
      const start = filters.startDate;
      results = results.filter((e) => e.timestamp >= start);
    }

    if (filters.endDate) {
      const end = filters.endDate;
      results = results.filter((e) => e.timestamp <= end);
    }

    // Newest first
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters.limit !== undefined && filters.limit > 0) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * Returns audit entries for a specific user, newest first.
   */
  getByUser(userId: string, limit?: number): readonly AuditEntry[] {
    return this.query({ userId, limit });
  }

  /**
   * Returns audit entries for a specific action, newest first.
   */
  getByAction(action: string, limit?: number): readonly AuditEntry[] {
    return this.query({ action, limit });
  }

  /**
   * Returns the total number of entries in the log.
   */
  get size(): number {
    return this.entries.length;
  }
}
