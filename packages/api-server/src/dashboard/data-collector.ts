/**
 * Dashboard data collector — aggregates index health, search analytics,
 * user info, and usage statistics from in-memory counters.
 */

import type { LanceDBStore, CodeRAGConfig } from '@code-rag/core';
import type { ApiKeyEntry } from '../middleware/auth.js';
import type {
  IndexOverview,
  SearchAnalytics,
  UserInfo,
  UsageStats,
  DashboardConfig,
  SearchRecord,
  RequestRecord,
  DailyQueryCount,
  TopQuery,
} from './types.js';

const DEFAULT_CONFIG: DashboardConfig = {
  maxSearchRecords: 10_000,
  maxRequestRecords: 50_000,
  topQueriesLimit: 20,
};

const MS_PER_DAY = 86_400_000;

export interface DashboardDataCollectorDeps {
  readonly getStore: () => LanceDBStore | null;
  readonly getConfig: () => CodeRAGConfig | null;
  readonly apiKeys: ReadonlyArray<ApiKeyEntry>;
}

export class DashboardDataCollector {
  private readonly deps: DashboardDataCollectorDeps;
  private readonly config: DashboardConfig;
  private readonly searchRecords: SearchRecord[] = [];
  private readonly requestRecords: RequestRecord[] = [];
  private readonly userActivity: Map<string, { lastActive: number; queryCount: number }> = new Map();
  private lastIndexedTimestamp: string | null = null;

  constructor(deps: DashboardDataCollectorDeps, config?: Partial<DashboardConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an incoming HTTP request for usage tracking.
   */
  recordRequest(method: string, path: string, apiKeyId: string | null): void {
    this.requestRecords.push({
      method,
      path,
      apiKeyId,
      timestamp: Date.now(),
    });

    // Evict oldest records if we exceed the limit
    if (this.requestRecords.length > this.config.maxRequestRecords) {
      this.requestRecords.splice(0, this.requestRecords.length - this.config.maxRequestRecords);
    }
  }

  /**
   * Record a search query for analytics.
   */
  recordSearch(query: string, latencyMs: number, success: boolean, apiKeyId?: string | null): void {
    this.searchRecords.push({
      query,
      latencyMs,
      success,
      timestamp: Date.now(),
    });

    // Evict oldest records if we exceed the limit
    if (this.searchRecords.length > this.config.maxSearchRecords) {
      this.searchRecords.splice(0, this.searchRecords.length - this.config.maxSearchRecords);
    }

    // Update per-user activity
    if (apiKeyId) {
      const existing = this.userActivity.get(apiKeyId);
      if (existing) {
        existing.lastActive = Date.now();
        existing.queryCount += 1;
      } else {
        this.userActivity.set(apiKeyId, { lastActive: Date.now(), queryCount: 1 });
      }
    }
  }

  /**
   * Mark the last indexing timestamp.
   */
  setLastIndexed(timestamp: string): void {
    this.lastIndexedTimestamp = timestamp;
  }

  /**
   * Get index overview by querying the LanceDB store.
   */
  async getIndexOverview(): Promise<IndexOverview> {
    const store = this.deps.getStore();
    const config = this.deps.getConfig();

    if (!store) {
      return {
        chunkCount: 0,
        fileCount: 0,
        languages: [],
        lastIndexed: this.lastIndexedTimestamp,
        storageBytes: 0,
        health: 'not_initialized',
      };
    }

    let chunkCount = 0;
    let health: IndexOverview['health'] = 'degraded';

    const countResult = await store.count();
    if (countResult.isOk()) {
      chunkCount = countResult.value;
      health = chunkCount > 0 ? 'healthy' : 'degraded';
    }

    const languages: string[] = Array.isArray(config?.project.languages)
      ? [...config.project.languages]
      : [];

    return {
      chunkCount,
      fileCount: estimateFileCount(chunkCount),
      languages,
      lastIndexed: this.lastIndexedTimestamp,
      storageBytes: estimateStorageBytes(chunkCount),
      health,
    };
  }

  /**
   * Get search analytics for the last N days.
   */
  getSearchAnalytics(days: number = 30): SearchAnalytics {
    const cutoff = Date.now() - days * MS_PER_DAY;
    const relevant = this.searchRecords.filter((r) => r.timestamp >= cutoff);

    const totalQueries = relevant.length;

    // Per-day counts
    const dayCounts = new Map<string, number>();
    for (const record of relevant) {
      const dateStr = new Date(record.timestamp).toISOString().slice(0, 10);
      dayCounts.set(dateStr, (dayCounts.get(dateStr) ?? 0) + 1);
    }

    const queriesPerDay: DailyQueryCount[] = [];
    for (const [date, count] of dayCounts.entries()) {
      queriesPerDay.push({ date, count });
    }
    queriesPerDay.sort((a, b) => a.date.localeCompare(b.date));

    // Top queries
    const queryCounts = new Map<string, number>();
    for (const record of relevant) {
      const normalizedQuery = record.query.toLowerCase().trim();
      queryCounts.set(normalizedQuery, (queryCounts.get(normalizedQuery) ?? 0) + 1);
    }

    const topQueries: TopQuery[] = [];
    for (const [query, count] of queryCounts.entries()) {
      topQueries.push({ query, count });
    }
    topQueries.sort((a, b) => b.count - a.count);
    const limitedTopQueries = topQueries.slice(0, this.config.topQueriesLimit);

    // Average latency
    const avgResponseTimeMs =
      totalQueries > 0
        ? relevant.reduce((sum, r) => sum + r.latencyMs, 0) / totalQueries
        : 0;

    // Error rate
    const errorCount = relevant.filter((r) => !r.success).length;
    const errorRate = totalQueries > 0 ? errorCount / totalQueries : 0;

    return {
      totalQueries,
      queriesPerDay,
      topQueries: limitedTopQueries,
      avgResponseTimeMs: Math.round(avgResponseTimeMs * 100) / 100,
      errorRate: Math.round(errorRate * 10000) / 10000,
    };
  }

  /**
   * Get user info from configured API keys + tracked activity.
   */
  getUsers(): ReadonlyArray<UserInfo> {
    return this.deps.apiKeys.map((keyEntry) => {
      const truncatedKey = truncateApiKey(keyEntry.key);
      const activity = this.userActivity.get(keyEntry.key);

      return {
        userId: truncatedKey,
        role: keyEntry.admin ? 'admin' as const : 'user' as const,
        lastActive: activity ? new Date(activity.lastActive).toISOString() : null,
        queryCount: activity?.queryCount ?? 0,
      };
    });
  }

  /**
   * Get overall usage statistics.
   */
  getUsageStats(): UsageStats {
    const now = Date.now();
    const oneDayAgo = now - MS_PER_DAY;
    const oneWeekAgo = now - 7 * MS_PER_DAY;
    const oneMonthAgo = now - 30 * MS_PER_DAY;

    const apiCallsToday = this.requestRecords.filter((r) => r.timestamp >= oneDayAgo).length;
    const apiCallsWeek = this.requestRecords.filter((r) => r.timestamp >= oneWeekAgo).length;
    const apiCallsMonth = this.requestRecords.filter((r) => r.timestamp >= oneMonthAgo).length;

    const store = this.deps.getStore();
    const storageBytes = store ? estimateStorageBytes(this.requestRecords.length) : 0;

    const costEstimate = formatCostEstimate(apiCallsMonth);

    return {
      apiCallsToday,
      apiCallsWeek,
      apiCallsMonth,
      storageBytes,
      costEstimate,
    };
  }

  /**
   * Get the current dashboard configuration.
   */
  getConfig(): DashboardConfig {
    return { ...this.config };
  }

  /**
   * Get the number of search records currently stored.
   */
  getSearchRecordCount(): number {
    return this.searchRecords.length;
  }

  /**
   * Get the number of request records currently stored.
   */
  getRequestRecordCount(): number {
    return this.requestRecords.length;
  }
}

/**
 * Truncate an API key to show only the first 8 chars + ellipsis.
 */
function truncateApiKey(key: string): string {
  if (key.length <= 8) {
    return key;
  }
  return `${key.slice(0, 8)}...`;
}

/**
 * Rough estimate of file count from chunk count.
 * Assumes ~5 chunks per file on average.
 */
function estimateFileCount(chunkCount: number): number {
  if (chunkCount === 0) return 0;
  return Math.max(1, Math.ceil(chunkCount / 5));
}

/**
 * Rough estimate of storage bytes from chunk count.
 * Assumes ~4KB per chunk (content + embedding + metadata).
 */
function estimateStorageBytes(chunkCount: number): number {
  return chunkCount * 4096;
}

/**
 * Format a simple cost estimate string based on API call volume.
 * Local-first = free. Shows informational estimate only.
 */
function formatCostEstimate(monthlyApiCalls: number): string {
  if (monthlyApiCalls === 0) {
    return 'Free (local-first, no API calls)';
  }
  // Very rough estimate: $0.001 per API call for embedding APIs
  const estimatedCost = monthlyApiCalls * 0.001;
  if (estimatedCost < 0.01) {
    return `~$0.01/month (${monthlyApiCalls} API calls)`;
  }
  return `~$${estimatedCost.toFixed(2)}/month (${monthlyApiCalls} API calls)`;
}
