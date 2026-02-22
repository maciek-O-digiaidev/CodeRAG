/**
 * Dashboard data types for the CodeRAG admin dashboard.
 */

/**
 * Overview of a CodeRAG index — health, size, and composition.
 */
export interface IndexOverview {
  /** Total number of code chunks in the vector store. */
  readonly chunkCount: number;
  /** Number of distinct files indexed. */
  readonly fileCount: number;
  /** Programming languages present in the index. */
  readonly languages: ReadonlyArray<string>;
  /** ISO 8601 timestamp of last successful indexing run, or null if never indexed. */
  readonly lastIndexed: string | null;
  /** Approximate storage size in bytes used by the index. */
  readonly storageBytes: number;
  /** Overall index health. */
  readonly health: 'healthy' | 'degraded' | 'not_initialized';
}

/**
 * A single day's query count for the analytics chart.
 */
export interface DailyQueryCount {
  /** ISO 8601 date string (YYYY-MM-DD). */
  readonly date: string;
  /** Number of queries on that day. */
  readonly count: number;
}

/**
 * A frequently-queried search term with its count.
 */
export interface TopQuery {
  readonly query: string;
  readonly count: number;
}

/**
 * Aggregated search analytics for the dashboard.
 */
export interface SearchAnalytics {
  /** Total number of search queries recorded. */
  readonly totalQueries: number;
  /** Per-day query counts for the requested window. */
  readonly queriesPerDay: ReadonlyArray<DailyQueryCount>;
  /** Most frequently issued queries, sorted descending. */
  readonly topQueries: ReadonlyArray<TopQuery>;
  /** Average response time in milliseconds. */
  readonly avgResponseTimeMs: number;
  /** Fraction of queries that resulted in an error (0..1). */
  readonly errorRate: number;
}

/**
 * Information about a configured API key user.
 */
export interface UserInfo {
  /** Identifier for the user (truncated key or label). */
  readonly userId: string;
  /** Role derived from the API key configuration. */
  readonly role: 'admin' | 'user';
  /** ISO 8601 timestamp of last activity, or null. */
  readonly lastActive: string | null;
  /** Number of queries issued by this user. */
  readonly queryCount: number;
}

/**
 * API usage statistics for cost tracking.
 */
export interface UsageStats {
  /** API calls in the current day. */
  readonly apiCallsToday: number;
  /** API calls in the current week (last 7 days). */
  readonly apiCallsWeek: number;
  /** API calls in the current month (last 30 days). */
  readonly apiCallsMonth: number;
  /** Total storage bytes used by the index. */
  readonly storageBytes: number;
  /** Estimated cost string (informational). */
  readonly costEstimate: string;
}

/**
 * Dashboard-specific configuration.
 */
export interface DashboardConfig {
  /** Maximum number of search records to retain in memory. */
  readonly maxSearchRecords: number;
  /** Maximum number of request records to retain in memory. */
  readonly maxRequestRecords: number;
  /** Number of top queries to show. */
  readonly topQueriesLimit: number;
}

/**
 * A recorded search event for analytics.
 */
export interface SearchRecord {
  readonly query: string;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly timestamp: number;
}

/**
 * A recorded HTTP request event.
 */
export interface RequestRecord {
  readonly method: string;
  readonly path: string;
  readonly apiKeyId: string | null;
  readonly timestamp: number;
}

/**
 * Which dashboard page to render.
 */
export type DashboardPage = 'overview' | 'analytics' | 'users' | 'settings';

/**
 * Optional flash message to display at the top of the page.
 */
export interface FlashMessage {
  readonly type: 'success' | 'error' | 'info';
  readonly text: string;
}
