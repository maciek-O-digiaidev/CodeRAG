import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLogger } from './audit-log.js';
import type { AuditEntry } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    timestamp: new Date('2026-02-22T10:00:00Z'),
    userId: 'user-1',
    action: 'search',
    resource: 'repo-a',
    details: 'searched for authentication module',
    ip: '10.0.0.1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditLogger', () => {
  // -----------------------------------------------------------------------
  // In-memory mode
  // -----------------------------------------------------------------------

  describe('in-memory mode', () => {
    it('should start with zero entries', () => {
      const logger = new AuditLogger();
      expect(logger.size).toBe(0);
    });

    it('should log an entry', () => {
      const logger = new AuditLogger();
      logger.log(createEntry());
      expect(logger.size).toBe(1);
    });

    it('should log multiple entries', () => {
      const logger = new AuditLogger();
      logger.log(createEntry({ userId: 'u1' }));
      logger.log(createEntry({ userId: 'u2' }));
      logger.log(createEntry({ userId: 'u3' }));
      expect(logger.size).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // query
  // -----------------------------------------------------------------------

  describe('query', () => {
    let logger: AuditLogger;

    beforeEach(() => {
      logger = new AuditLogger();
      logger.log(createEntry({
        timestamp: new Date('2026-02-22T09:00:00Z'),
        userId: 'user-1',
        action: 'search',
      }));
      logger.log(createEntry({
        timestamp: new Date('2026-02-22T10:00:00Z'),
        userId: 'user-2',
        action: 'index',
      }));
      logger.log(createEntry({
        timestamp: new Date('2026-02-22T11:00:00Z'),
        userId: 'user-1',
        action: 'configure',
      }));
      logger.log(createEntry({
        timestamp: new Date('2026-02-22T12:00:00Z'),
        userId: 'user-3',
        action: 'search',
      }));
    });

    it('should return all entries when no filters are specified', () => {
      const results = logger.query({});
      expect(results).toHaveLength(4);
    });

    it('should return entries in reverse-chronological order', () => {
      const results = logger.query({});
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.timestamp.getTime()).toBeGreaterThanOrEqual(
          results[i + 1]!.timestamp.getTime(),
        );
      }
    });

    it('should filter by userId', () => {
      const results = logger.query({ userId: 'user-1' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.userId === 'user-1')).toBe(true);
    });

    it('should filter by action', () => {
      const results = logger.query({ action: 'search' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.action === 'search')).toBe(true);
    });

    it('should filter by startDate', () => {
      const results = logger.query({
        startDate: new Date('2026-02-22T10:30:00Z'),
      });
      expect(results).toHaveLength(2);
    });

    it('should filter by endDate', () => {
      const results = logger.query({
        endDate: new Date('2026-02-22T10:30:00Z'),
      });
      expect(results).toHaveLength(2);
    });

    it('should filter by date range', () => {
      const results = logger.query({
        startDate: new Date('2026-02-22T09:30:00Z'),
        endDate: new Date('2026-02-22T11:30:00Z'),
      });
      expect(results).toHaveLength(2);
    });

    it('should respect the limit parameter', () => {
      const results = logger.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should combine filters', () => {
      const results = logger.query({
        userId: 'user-1',
        action: 'search',
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.userId).toBe('user-1');
      expect(results[0]!.action).toBe('search');
    });

    it('should return empty array when no entries match', () => {
      const results = logger.query({ userId: 'nonexistent' });
      expect(results).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // getByUser
  // -----------------------------------------------------------------------

  describe('getByUser', () => {
    it('should return entries for a specific user', () => {
      const logger = new AuditLogger();
      logger.log(createEntry({ userId: 'alice' }));
      logger.log(createEntry({ userId: 'bob' }));
      logger.log(createEntry({ userId: 'alice' }));

      const results = logger.getByUser('alice');
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.userId === 'alice')).toBe(true);
    });

    it('should respect the limit parameter', () => {
      const logger = new AuditLogger();
      for (let i = 0; i < 10; i++) {
        logger.log(createEntry({ userId: 'alice' }));
      }

      const results = logger.getByUser('alice', 3);
      expect(results).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // getByAction
  // -----------------------------------------------------------------------

  describe('getByAction', () => {
    it('should return entries for a specific action', () => {
      const logger = new AuditLogger();
      logger.log(createEntry({ action: 'search' }));
      logger.log(createEntry({ action: 'index' }));
      logger.log(createEntry({ action: 'search' }));

      const results = logger.getByAction('search');
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.action === 'search')).toBe(true);
    });

    it('should respect the limit parameter', () => {
      const logger = new AuditLogger();
      for (let i = 0; i < 10; i++) {
        logger.log(createEntry({ action: 'search' }));
      }

      const results = logger.getByAction('search', 5);
      expect(results).toHaveLength(5);
    });
  });

  // -----------------------------------------------------------------------
  // File persistence
  // -----------------------------------------------------------------------

  describe('file persistence', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'coderag-audit-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('should write entries to a JSON-lines file', () => {
      const filePath = join(tempDir, 'audit.jsonl');
      const logger = new AuditLogger(filePath);
      logger.log(createEntry({ userId: 'alice', action: 'search' }));
      logger.log(createEntry({ userId: 'bob', action: 'index' }));

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const parsed0 = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(parsed0['userId']).toBe('alice');
      const parsed1 = JSON.parse(lines[1]!) as Record<string, unknown>;
      expect(parsed1['userId']).toBe('bob');
    });

    it('should load existing entries from file on construction', () => {
      const filePath = join(tempDir, 'audit.jsonl');

      // Create initial logger and write entries
      const logger1 = new AuditLogger(filePath);
      logger1.log(createEntry({ userId: 'alice' }));
      logger1.log(createEntry({ userId: 'bob' }));

      // Create new logger that should load from file
      const logger2 = new AuditLogger(filePath);
      expect(logger2.size).toBe(2);

      const results = logger2.getByUser('alice');
      expect(results).toHaveLength(1);
    });

    it('should append to existing file', () => {
      const filePath = join(tempDir, 'audit.jsonl');

      const logger1 = new AuditLogger(filePath);
      logger1.log(createEntry({ userId: 'alice' }));

      const logger2 = new AuditLogger(filePath);
      logger2.log(createEntry({ userId: 'bob' }));

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      // logger1 wrote 1 line, logger2 appended 1 more line
      expect(lines).toHaveLength(2);

      // logger2 should have both in-memory (loaded + new)
      expect(logger2.size).toBe(2);
    });

    it('should create parent directories if they do not exist', () => {
      const filePath = join(tempDir, 'nested', 'deep', 'audit.jsonl');
      const logger = new AuditLogger(filePath);
      logger.log(createEntry());

      expect(existsSync(filePath)).toBe(true);
    });

    it('should handle corrupt file gracefully', () => {
      const filePath = join(tempDir, 'corrupt.jsonl');
      // Write corrupt data
      const { writeFileSync } = require('node:fs') as typeof import('node:fs');
      writeFileSync(filePath, 'not valid json\n{broken\n');

      // Should not throw, starts fresh in-memory
      const logger = new AuditLogger(filePath);
      expect(logger.size).toBe(0);
    });

    it('should serialize timestamp as ISO string', () => {
      const filePath = join(tempDir, 'audit.jsonl');
      const logger = new AuditLogger(filePath);
      const timestamp = new Date('2026-02-22T15:30:00Z');
      logger.log(createEntry({ timestamp }));

      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
      expect(parsed['timestamp']).toBe('2026-02-22T15:30:00.000Z');
    });

    it('should deserialize timestamp back to Date on load', () => {
      const filePath = join(tempDir, 'audit.jsonl');
      const timestamp = new Date('2026-02-22T15:30:00Z');

      const logger1 = new AuditLogger(filePath);
      logger1.log(createEntry({ timestamp }));

      const logger2 = new AuditLogger(filePath);
      const results = logger2.query({});
      expect(results).toHaveLength(1);
      expect(results[0]!.timestamp).toBeInstanceOf(Date);
      expect(results[0]!.timestamp.toISOString()).toBe('2026-02-22T15:30:00.000Z');
    });
  });
});
