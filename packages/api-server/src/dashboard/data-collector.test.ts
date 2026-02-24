import { describe, it, expect, vi } from 'vitest';
import { ok, err } from 'neverthrow';
import { StoreError } from '@code-rag/core';
import type { LanceDBStore, CodeRAGConfig } from '@code-rag/core';
import type { ApiKeyEntry } from '../middleware/auth.js';
import { DashboardDataCollector, type DashboardDataCollectorDeps } from './data-collector.js';

// --- Helpers ---

function mockStore(overrides: Partial<LanceDBStore> = {}): LanceDBStore {
  return {
    count: vi.fn().mockResolvedValue(ok(42)),
    ...overrides,
  } as unknown as LanceDBStore;
}

function mockConfig(overrides: Partial<CodeRAGConfig> = {}): CodeRAGConfig {
  return {
    version: '1',
    project: { name: 'test-project', languages: ['typescript', 'python'] },
    ingestion: { maxTokensPerChunk: 512, exclude: [] },
    embedding: { provider: 'ollama', model: 'nomic-embed-text', dimensions: 768, autoStart: true, autoStop: false, docker: { image: 'ollama/ollama', gpu: 'auto' } },
    llm: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    search: { topK: 10, vectorWeight: 0.7, bm25Weight: 0.3 },
    storage: { path: '.coderag' },
    ...overrides,
  } as CodeRAGConfig;
}

function createDeps(overrides: Partial<DashboardDataCollectorDeps> = {}): DashboardDataCollectorDeps {
  const store = mockStore();
  const config = mockConfig();
  return {
    getStore: () => store,
    getConfig: () => config,
    apiKeys: [],
    ...overrides,
  };
}

// --- getIndexOverview Tests ---

describe('DashboardDataCollector', () => {
  describe('getIndexOverview', () => {
    it('should return index overview with chunk count from store', async () => {
      const deps = createDeps();
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      expect(overview.chunkCount).toBe(42);
      expect(overview.health).toBe('healthy');
    });

    it('should estimate file count from chunk count', async () => {
      const deps = createDeps();
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      // 42 chunks / 5 ≈ 9 files
      expect(overview.fileCount).toBe(9);
    });

    it('should return languages from config', async () => {
      const deps = createDeps();
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      expect(overview.languages).toEqual(['typescript', 'python']);
    });

    it('should return not_initialized when store is null', async () => {
      const deps = createDeps({ getStore: () => null });
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      expect(overview.health).toBe('not_initialized');
      expect(overview.chunkCount).toBe(0);
      expect(overview.fileCount).toBe(0);
    });

    it('should return degraded when store count fails', async () => {
      const store = mockStore({
        count: vi.fn().mockResolvedValue(err(new StoreError('Connection lost'))),
      });
      const deps = createDeps({ getStore: () => store });
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      expect(overview.health).toBe('degraded');
      expect(overview.chunkCount).toBe(0);
    });

    it('should return degraded when store is empty', async () => {
      const store = mockStore({
        count: vi.fn().mockResolvedValue(ok(0)),
      });
      const deps = createDeps({ getStore: () => store });
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      expect(overview.health).toBe('degraded');
    });

    it('should estimate storage bytes from chunk count', async () => {
      const deps = createDeps();
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      // 42 chunks * 4096 bytes
      expect(overview.storageBytes).toBe(42 * 4096);
    });

    it('should return lastIndexed timestamp when set', async () => {
      const deps = createDeps();
      const collector = new DashboardDataCollector(deps);
      collector.setLastIndexed('2026-02-22T10:00:00Z');

      const overview = await collector.getIndexOverview();

      expect(overview.lastIndexed).toBe('2026-02-22T10:00:00Z');
    });

    it('should return null lastIndexed when never indexed', async () => {
      const deps = createDeps();
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      expect(overview.lastIndexed).toBeNull();
    });

    it('should return empty languages when config has none', async () => {
      const config = mockConfig({ project: { name: 'test', languages: [] } } as Partial<CodeRAGConfig>);
      const deps = createDeps({ getConfig: () => config });
      const collector = new DashboardDataCollector(deps);

      const overview = await collector.getIndexOverview();

      expect(overview.languages).toEqual([]);
    });
  });

  // --- recordSearch & getSearchAnalytics Tests ---

  describe('recordSearch / getSearchAnalytics', () => {
    it('should record searches and return total count', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordSearch('hello world', 50, true);
      collector.recordSearch('function parser', 30, true);

      const analytics = collector.getSearchAnalytics(30);

      expect(analytics.totalQueries).toBe(2);
    });

    it('should calculate average response time', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordSearch('query1', 100, true);
      collector.recordSearch('query2', 200, true);
      collector.recordSearch('query3', 300, true);

      const analytics = collector.getSearchAnalytics(30);

      expect(analytics.avgResponseTimeMs).toBe(200);
    });

    it('should calculate error rate', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordSearch('good1', 50, true);
      collector.recordSearch('good2', 50, true);
      collector.recordSearch('bad1', 50, false);
      collector.recordSearch('bad2', 50, false);

      const analytics = collector.getSearchAnalytics(30);

      expect(analytics.errorRate).toBe(0.5);
    });

    it('should return top queries sorted by count', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordSearch('common query', 50, true);
      collector.recordSearch('common query', 50, true);
      collector.recordSearch('common query', 50, true);
      collector.recordSearch('rare query', 50, true);

      const analytics = collector.getSearchAnalytics(30);

      expect(analytics.topQueries[0]!.query).toBe('common query');
      expect(analytics.topQueries[0]!.count).toBe(3);
      expect(analytics.topQueries[1]!.query).toBe('rare query');
      expect(analytics.topQueries[1]!.count).toBe(1);
    });

    it('should normalize top queries to lowercase', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordSearch('Hello World', 50, true);
      collector.recordSearch('hello world', 50, true);

      const analytics = collector.getSearchAnalytics(30);

      expect(analytics.topQueries).toHaveLength(1);
      expect(analytics.topQueries[0]!.count).toBe(2);
    });

    it('should group queries by day', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordSearch('q1', 50, true);
      collector.recordSearch('q2', 50, true);

      const analytics = collector.getSearchAnalytics(30);

      expect(analytics.queriesPerDay.length).toBeGreaterThanOrEqual(1);
      const today = new Date().toISOString().slice(0, 10);
      const todayEntry = analytics.queriesPerDay.find((d) => d.date === today);
      expect(todayEntry?.count).toBe(2);
    });

    it('should return empty analytics when no searches recorded', () => {
      const collector = new DashboardDataCollector(createDeps());

      const analytics = collector.getSearchAnalytics(30);

      expect(analytics.totalQueries).toBe(0);
      expect(analytics.queriesPerDay).toEqual([]);
      expect(analytics.topQueries).toEqual([]);
      expect(analytics.avgResponseTimeMs).toBe(0);
      expect(analytics.errorRate).toBe(0);
    });

    it('should filter searches by date range', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordSearch('recent', 50, true);

      // Requesting 0 days means cutoff = now, so entries at now are included
      const analytics = collector.getSearchAnalytics(0);
      expect(analytics.totalQueries).toBe(1);

      // All queries within 30 days should be returned
      const analytics30 = collector.getSearchAnalytics(30);
      expect(analytics30.totalQueries).toBe(1);
    });

    it('should limit top queries to configured limit', () => {
      const collector = new DashboardDataCollector(createDeps(), { topQueriesLimit: 2 });

      collector.recordSearch('a', 50, true);
      collector.recordSearch('b', 50, true);
      collector.recordSearch('c', 50, true);

      const analytics = collector.getSearchAnalytics(30);

      expect(analytics.topQueries.length).toBeLessThanOrEqual(2);
    });

    it('should evict old search records when exceeding max limit', () => {
      const collector = new DashboardDataCollector(createDeps(), { maxSearchRecords: 3 });

      collector.recordSearch('q1', 50, true);
      collector.recordSearch('q2', 50, true);
      collector.recordSearch('q3', 50, true);
      collector.recordSearch('q4', 50, true);

      expect(collector.getSearchRecordCount()).toBe(3);
    });
  });

  // --- recordRequest & getUsageStats Tests ---

  describe('recordRequest / getUsageStats', () => {
    it('should count API calls today', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordRequest('GET', '/api/v1/status', null);
      collector.recordRequest('POST', '/api/v1/search', null);

      const stats = collector.getUsageStats();

      expect(stats.apiCallsToday).toBe(2);
    });

    it('should count API calls for week and month', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordRequest('GET', '/health', null);

      const stats = collector.getUsageStats();

      expect(stats.apiCallsWeek).toBeGreaterThanOrEqual(1);
      expect(stats.apiCallsMonth).toBeGreaterThanOrEqual(1);
    });

    it('should return zero stats when no requests recorded', () => {
      const collector = new DashboardDataCollector(createDeps());

      const stats = collector.getUsageStats();

      expect(stats.apiCallsToday).toBe(0);
      expect(stats.apiCallsWeek).toBe(0);
      expect(stats.apiCallsMonth).toBe(0);
    });

    it('should evict old request records when exceeding max limit', () => {
      const collector = new DashboardDataCollector(createDeps(), { maxRequestRecords: 3 });

      collector.recordRequest('GET', '/a', null);
      collector.recordRequest('GET', '/b', null);
      collector.recordRequest('GET', '/c', null);
      collector.recordRequest('GET', '/d', null);

      expect(collector.getRequestRecordCount()).toBe(3);
    });

    it('should include cost estimate string', () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.recordRequest('GET', '/api/v1/status', null);

      const stats = collector.getUsageStats();

      expect(typeof stats.costEstimate).toBe('string');
      expect(stats.costEstimate.length).toBeGreaterThan(0);
    });
  });

  // --- getUsers Tests ---

  describe('getUsers', () => {
    it('should return users from API keys', () => {
      const apiKeys: ApiKeyEntry[] = [
        { key: 'admin-key-12345', admin: true },
        { key: 'user-key-67890', admin: false },
      ];
      const collector = new DashboardDataCollector(createDeps({ apiKeys }));

      const users = collector.getUsers();

      expect(users).toHaveLength(2);
      expect(users[0]!.role).toBe('admin');
      expect(users[1]!.role).toBe('user');
    });

    it('should truncate user IDs to first 8 characters', () => {
      const apiKeys: ApiKeyEntry[] = [
        { key: 'very-long-api-key-string', admin: false },
      ];
      const collector = new DashboardDataCollector(createDeps({ apiKeys }));

      const users = collector.getUsers();

      expect(users[0]!.userId).toBe('very-lon...');
    });

    it('should not truncate short keys', () => {
      const apiKeys: ApiKeyEntry[] = [
        { key: 'short', admin: false },
      ];
      const collector = new DashboardDataCollector(createDeps({ apiKeys }));

      const users = collector.getUsers();

      expect(users[0]!.userId).toBe('short');
    });

    it('should track user activity from searches', () => {
      const apiKeys: ApiKeyEntry[] = [
        { key: 'test-key', admin: false },
      ];
      const collector = new DashboardDataCollector(createDeps({ apiKeys }));

      collector.recordSearch('hello', 50, true, 'test-key');
      collector.recordSearch('world', 30, true, 'test-key');

      const users = collector.getUsers();

      expect(users[0]!.queryCount).toBe(2);
      expect(users[0]!.lastActive).not.toBeNull();
    });

    it('should return zero query count for inactive users', () => {
      const apiKeys: ApiKeyEntry[] = [
        { key: 'inactive-user-key', admin: false },
      ];
      const collector = new DashboardDataCollector(createDeps({ apiKeys }));

      const users = collector.getUsers();

      expect(users[0]!.queryCount).toBe(0);
      expect(users[0]!.lastActive).toBeNull();
    });

    it('should return empty array when no API keys configured', () => {
      const collector = new DashboardDataCollector(createDeps({ apiKeys: [] }));

      const users = collector.getUsers();

      expect(users).toEqual([]);
    });
  });

  // --- getConfig Tests ---

  describe('getConfig', () => {
    it('should return default configuration', () => {
      const collector = new DashboardDataCollector(createDeps());

      const config = collector.getConfig();

      expect(config.maxSearchRecords).toBe(10_000);
      expect(config.maxRequestRecords).toBe(50_000);
      expect(config.topQueriesLimit).toBe(20);
    });

    it('should return custom configuration when provided', () => {
      const collector = new DashboardDataCollector(createDeps(), {
        maxSearchRecords: 500,
        topQueriesLimit: 5,
      });

      const config = collector.getConfig();

      expect(config.maxSearchRecords).toBe(500);
      expect(config.topQueriesLimit).toBe(5);
    });
  });

  // --- setLastIndexed Tests ---

  describe('setLastIndexed', () => {
    it('should update lastIndexed timestamp', async () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.setLastIndexed('2026-01-15T12:00:00Z');

      const overview = await collector.getIndexOverview();
      expect(overview.lastIndexed).toBe('2026-01-15T12:00:00Z');
    });

    it('should overwrite previous lastIndexed', async () => {
      const collector = new DashboardDataCollector(createDeps());

      collector.setLastIndexed('2026-01-01T00:00:00Z');
      collector.setLastIndexed('2026-02-01T00:00:00Z');

      const overview = await collector.getIndexOverview();
      expect(overview.lastIndexed).toBe('2026-02-01T00:00:00Z');
    });
  });
});
