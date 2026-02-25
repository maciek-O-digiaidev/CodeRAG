import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AggregateMetrics } from '../metrics/types.js';
import type { BaselineData, CIBenchmarkResult, HistoryEntry } from './types.js';
import {
  loadBaseline,
  saveBaseline,
  createBaseline,
  appendHistory,
  toHistoryEntry,
} from './baseline-manager.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  return {
    precisionAt5: 0.8,
    precisionAt10: 0.6,
    recallAt5: 0.7,
    recallAt10: 0.5,
    mrr: 0.9,
    ndcgAt10: 0.75,
    map: 0.65,
    contextPrecision: 0.85,
    contextRecall: null,
    ...overrides,
  };
}

function makeBaseline(): BaselineData {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    commitSha: 'abc123',
    seed: 42,
    queryCount: 50,
    metrics: makeMetrics(),
  };
}

function makeResult(): CIBenchmarkResult {
  return {
    timestamp: '2026-01-02T00:00:00.000Z',
    commitSha: 'def456',
    branch: 'feature/test',
    seed: 42,
    queryCount: 50,
    durationMs: 1500,
    metrics: makeMetrics(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('baseline-manager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'baseline-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('saveBaseline + loadBaseline roundtrip', () => {
    it('should save and load a baseline correctly', async () => {
      const baseline = makeBaseline();
      const filePath = join(tmpDir, 'baseline.json');

      const saveResult = await saveBaseline(filePath, baseline);
      expect(saveResult.isOk()).toBe(true);

      const loadResult = await loadBaseline(filePath);
      expect(loadResult.isOk()).toBe(true);

      if (loadResult.isOk()) {
        expect(loadResult.value.timestamp).toBe(baseline.timestamp);
        expect(loadResult.value.commitSha).toBe(baseline.commitSha);
        expect(loadResult.value.seed).toBe(baseline.seed);
        expect(loadResult.value.queryCount).toBe(baseline.queryCount);
        expect(loadResult.value.metrics.precisionAt5).toBe(0.8);
        expect(loadResult.value.metrics.mrr).toBe(0.9);
      }
    });

    it('should create parent directories when saving', async () => {
      const baseline = makeBaseline();
      const filePath = join(tmpDir, 'nested', 'deep', 'baseline.json');

      const result = await saveBaseline(filePath, baseline);
      expect(result.isOk()).toBe(true);

      const loadResult = await loadBaseline(filePath);
      expect(loadResult.isOk()).toBe(true);
    });
  });

  describe('loadBaseline', () => {
    it('should return not_found for missing files', async () => {
      const filePath = join(tmpDir, 'nonexistent.json');
      const result = await loadBaseline(filePath);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('not_found');
      }
    });

    it('should return parse_error for invalid JSON', async () => {
      const filePath = join(tmpDir, 'invalid.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, 'not json', 'utf-8');

      const result = await loadBaseline(filePath);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('parse_error');
      }
    });

    it('should return parse_error for valid JSON with wrong schema', async () => {
      const filePath = join(tmpDir, 'wrong-schema.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, JSON.stringify({ foo: 'bar' }), 'utf-8');

      const result = await loadBaseline(filePath);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe('parse_error');
        if (result.error.kind === 'parse_error') {
          expect(result.error.message).toContain('does not match expected schema');
        }
      }
    });
  });

  describe('createBaseline', () => {
    it('should create a BaselineData from a CIBenchmarkResult', () => {
      const result = makeResult();
      const baseline = createBaseline(result);

      expect(baseline.timestamp).toBe(result.timestamp);
      expect(baseline.commitSha).toBe(result.commitSha);
      expect(baseline.seed).toBe(result.seed);
      expect(baseline.queryCount).toBe(result.queryCount);
      expect(baseline.metrics).toBe(result.metrics);
    });

    it('should not include branch or durationMs', () => {
      const result = makeResult();
      const baseline = createBaseline(result);
      const keys = Object.keys(baseline);

      expect(keys).not.toContain('branch');
      expect(keys).not.toContain('durationMs');
    });
  });

  describe('appendHistory', () => {
    it('should create a new history file with one entry', async () => {
      const filePath = join(tmpDir, 'history.json');
      const entry: HistoryEntry = {
        timestamp: '2026-01-01T00:00:00.000Z',
        commitSha: 'abc123',
        branch: 'main',
        metrics: makeMetrics(),
        durationMs: 1500,
      };

      const result = await appendHistory(filePath, entry);
      expect(result.isOk()).toBe(true);

      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as HistoryEntry[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.commitSha).toBe('abc123');
    });

    it('should append to existing history file', async () => {
      const filePath = join(tmpDir, 'history.json');
      const entry1: HistoryEntry = {
        timestamp: '2026-01-01T00:00:00.000Z',
        commitSha: 'abc123',
        branch: 'main',
        metrics: makeMetrics(),
        durationMs: 1500,
      };
      const entry2: HistoryEntry = {
        timestamp: '2026-01-02T00:00:00.000Z',
        commitSha: 'def456',
        branch: 'main',
        metrics: makeMetrics(),
        durationMs: 2000,
      };

      await appendHistory(filePath, entry1);
      await appendHistory(filePath, entry2);

      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as HistoryEntry[];
      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.commitSha).toBe('abc123');
      expect(parsed[1]?.commitSha).toBe('def456');
    });

    it('should create parent directories', async () => {
      const filePath = join(tmpDir, 'nested', 'history.json');
      const entry: HistoryEntry = {
        timestamp: '2026-01-01T00:00:00.000Z',
        commitSha: 'abc123',
        branch: 'main',
        metrics: makeMetrics(),
        durationMs: 1500,
      };

      const result = await appendHistory(filePath, entry);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('toHistoryEntry', () => {
    it('should convert a CIBenchmarkResult to a HistoryEntry', () => {
      const result = makeResult();
      const entry = toHistoryEntry(result);

      expect(entry.timestamp).toBe(result.timestamp);
      expect(entry.commitSha).toBe(result.commitSha);
      expect(entry.branch).toBe(result.branch);
      expect(entry.metrics).toBe(result.metrics);
      expect(entry.durationMs).toBe(result.durationMs);
    });

    it('should not include seed or queryCount', () => {
      const result = makeResult();
      const entry = toHistoryEntry(result);
      const keys = Object.keys(entry);

      expect(keys).not.toContain('seed');
      expect(keys).not.toContain('queryCount');
    });
  });
});
