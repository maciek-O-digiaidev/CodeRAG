import { describe, it, expect } from 'vitest';
import {
  renderDashboardPage,
  esc,
} from './templates.js';
import type {
  IndexOverview,
  SearchAnalytics,
  UserInfo,
  UsageStats,
  DashboardConfig,
} from './types.js';

// --- Helpers ---

function makeOverview(overrides: Partial<IndexOverview> = {}): IndexOverview {
  return {
    chunkCount: 1200,
    fileCount: 240,
    languages: ['typescript', 'python'],
    lastIndexed: '2026-02-22T10:00:00Z',
    storageBytes: 4_915_200,
    health: 'healthy',
    ...overrides,
  };
}

function makeUsageStats(overrides: Partial<UsageStats> = {}): UsageStats {
  return {
    apiCallsToday: 150,
    apiCallsWeek: 800,
    apiCallsMonth: 3200,
    storageBytes: 4_915_200,
    costEstimate: '~$3.20/month (3200 API calls)',
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<SearchAnalytics> = {}): SearchAnalytics {
  return {
    totalQueries: 450,
    queriesPerDay: [
      { date: '2026-02-20', count: 100 },
      { date: '2026-02-21', count: 150 },
      { date: '2026-02-22', count: 200 },
    ],
    topQueries: [
      { query: 'tree-sitter parser', count: 42 },
      { query: 'embedding provider', count: 31 },
    ],
    avgResponseTimeMs: 87.5,
    errorRate: 0.02,
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserInfo> = {}): UserInfo {
  return {
    userId: 'admin-ke...',
    role: 'admin',
    lastActive: '2026-02-22T09:30:00Z',
    queryCount: 55,
    ...overrides,
  };
}

function makeDashboardConfig(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
  return {
    maxSearchRecords: 10_000,
    maxRequestRecords: 50_000,
    topQueriesLimit: 20,
    ...overrides,
  };
}

// --- Layout & Navigation Tests ---

describe('renderDashboardPage', () => {
  describe('layout', () => {
    it('should render valid HTML with doctype', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include page title', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('<title>CodeRAG Dashboard');
      expect(html).toContain('Overview');
    });

    it('should include navigation sidebar', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('<nav');
      expect(html).toContain('/dashboard/overview');
      expect(html).toContain('/dashboard/analytics');
      expect(html).toContain('/dashboard/users');
      expect(html).toContain('/dashboard/settings');
    });

    it('should mark active page in navigation', () => {
      const html = renderDashboardPage({
        page: 'analytics',
        data: { analytics: makeAnalytics() },
      });

      expect(html).toContain('class="active"');
      // The active link should be the analytics one
      expect(html).toMatch(/href="\/dashboard\/analytics"[^>]*class="active"/);
    });

    it('should include inline CSS', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('<style>');
      expect(html).toContain('--primary');
    });

    it('should include CodeRAG logo text', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('CodeRAG');
      expect(html).toContain('Admin Dashboard');
    });
  });

  // --- Overview Page Tests ---

  describe('overview page', () => {
    it('should render index health badge', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview({ health: 'healthy' }), usageStats: makeUsageStats() },
      });

      expect(html).toContain('badge');
      expect(html).toContain('healthy');
    });

    it('should render degraded health badge', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview({ health: 'degraded' }), usageStats: makeUsageStats() },
      });

      expect(html).toContain('badge-yellow');
      expect(html).toContain('degraded');
    });

    it('should render not_initialized health badge', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview({ health: 'not_initialized' }), usageStats: makeUsageStats() },
      });

      expect(html).toContain('badge-red');
      expect(html).toContain('not_initialized');
    });

    it('should display chunk and file counts', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('1,200');
      expect(html).toContain('240');
    });

    it('should display languages', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('typescript, python');
    });

    it('should display "Never" when lastIndexed is null', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview({ lastIndexed: null }), usageStats: makeUsageStats() },
      });

      expect(html).toContain('Never');
    });

    it('should display usage stats', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('150');
      expect(html).toContain('800');
      expect(html).toContain('3,200');
    });

    it('should include re-index button as a form', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: { overview: makeOverview(), usageStats: makeUsageStats() },
      });

      expect(html).toContain('method="POST"');
      expect(html).toContain('action="/dashboard/actions/reindex"');
      expect(html).toContain('Re-index Now');
    });

    it('should display flash message when provided', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: {
          overview: makeOverview(),
          usageStats: makeUsageStats(),
          flash: { type: 'success', text: 'Re-indexing completed successfully!' },
        },
      });

      expect(html).toContain('flash-success');
      expect(html).toContain('Re-indexing completed successfully!');
    });

    it('should display error flash message', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: {
          overview: makeOverview(),
          usageStats: makeUsageStats(),
          flash: { type: 'error', text: 'Something went wrong' },
        },
      });

      expect(html).toContain('flash-error');
      expect(html).toContain('Something went wrong');
    });

    it('should handle zero chunks gracefully', () => {
      const html = renderDashboardPage({
        page: 'overview',
        data: {
          overview: makeOverview({ chunkCount: 0, fileCount: 0, storageBytes: 0 }),
          usageStats: makeUsageStats({ apiCallsToday: 0, apiCallsWeek: 0, apiCallsMonth: 0 }),
        },
      });

      expect(html).toContain('0');
      expect(html).toContain('0 B');
    });
  });

  // --- Analytics Page Tests ---

  describe('analytics page', () => {
    it('should render total query count', () => {
      const html = renderDashboardPage({
        page: 'analytics',
        data: { analytics: makeAnalytics() },
      });

      expect(html).toContain('450');
    });

    it('should render average response time', () => {
      const html = renderDashboardPage({
        page: 'analytics',
        data: { analytics: makeAnalytics() },
      });

      expect(html).toContain('87.5');
    });

    it('should render error rate as percentage', () => {
      const html = renderDashboardPage({
        page: 'analytics',
        data: { analytics: makeAnalytics() },
      });

      expect(html).toContain('2.00%');
    });

    it('should render query chart bars', () => {
      const html = renderDashboardPage({
        page: 'analytics',
        data: { analytics: makeAnalytics() },
      });

      expect(html).toContain('bar-group');
      expect(html).toContain('bar');
    });

    it('should render top queries table', () => {
      const html = renderDashboardPage({
        page: 'analytics',
        data: { analytics: makeAnalytics() },
      });

      expect(html).toContain('tree-sitter parser');
      expect(html).toContain('42');
      expect(html).toContain('embedding provider');
      expect(html).toContain('31');
    });

    it('should handle empty analytics data', () => {
      const html = renderDashboardPage({
        page: 'analytics',
        data: {
          analytics: makeAnalytics({
            totalQueries: 0,
            queriesPerDay: [],
            topQueries: [],
            avgResponseTimeMs: 0,
            errorRate: 0,
          }),
        },
      });

      expect(html).toContain('No query');
      expect(html).toContain('0');
    });
  });

  // --- Users Page Tests ---

  describe('users page', () => {
    it('should render user table with role badges', () => {
      const html = renderDashboardPage({
        page: 'users',
        data: { users: [makeUser()] },
      });

      expect(html).toContain('data-table');
      expect(html).toContain('admin-ke...');
      expect(html).toContain('badge');
      expect(html).toContain('admin');
    });

    it('should render user role badge', () => {
      const html = renderDashboardPage({
        page: 'users',
        data: { users: [makeUser({ role: 'user' })] },
      });

      expect(html).toContain('badge-blue');
      expect(html).toContain('user');
    });

    it('should render admin role badge with purple color', () => {
      const html = renderDashboardPage({
        page: 'users',
        data: { users: [makeUser({ role: 'admin' })] },
      });

      expect(html).toContain('badge-purple');
    });

    it('should show "Never" for inactive users', () => {
      const html = renderDashboardPage({
        page: 'users',
        data: { users: [makeUser({ lastActive: null })] },
      });

      expect(html).toContain('Never');
    });

    it('should display query count', () => {
      const html = renderDashboardPage({
        page: 'users',
        data: { users: [makeUser({ queryCount: 123 })] },
      });

      expect(html).toContain('123');
    });

    it('should show empty state when no users', () => {
      const html = renderDashboardPage({
        page: 'users',
        data: { users: [] },
      });

      expect(html).toContain('No API keys configured');
    });

    it('should render multiple users', () => {
      const html = renderDashboardPage({
        page: 'users',
        data: {
          users: [
            makeUser({ userId: 'admin-1', role: 'admin' }),
            makeUser({ userId: 'user-1', role: 'user' }),
          ],
        },
      });

      expect(html).toContain('admin-1');
      expect(html).toContain('user-1');
    });
  });

  // --- Settings Page Tests ---

  describe('settings page', () => {
    it('should display project configuration', () => {
      const html = renderDashboardPage({
        page: 'settings',
        data: {
          config: makeDashboardConfig(),
          projectConfig: {
            name: 'my-project',
            embeddingModel: 'nomic-embed-text',
            storagePath: '.coderag',
          },
        },
      });

      expect(html).toContain('my-project');
      expect(html).toContain('nomic-embed-text');
      expect(html).toContain('.coderag');
    });

    it('should display dashboard config values', () => {
      const html = renderDashboardPage({
        page: 'settings',
        data: {
          config: makeDashboardConfig({ maxSearchRecords: 5000 }),
          projectConfig: null,
        },
      });

      expect(html).toContain('5,000');
    });

    it('should show empty state when project config is null', () => {
      const html = renderDashboardPage({
        page: 'settings',
        data: {
          config: makeDashboardConfig(),
          projectConfig: null,
        },
      });

      expect(html).toContain('not loaded');
    });

    it('should include re-index trigger form', () => {
      const html = renderDashboardPage({
        page: 'settings',
        data: {
          config: makeDashboardConfig(),
          projectConfig: null,
        },
      });

      expect(html).toContain('method="POST"');
      expect(html).toContain('action="/dashboard/actions/reindex"');
      expect(html).toContain('Trigger Re-index');
    });
  });
});

// --- esc() Tests ---

describe('esc', () => {
  it('should escape HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('should escape ampersands', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('should escape single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s');
  });

  it('should return empty string unchanged', () => {
    expect(esc('')).toBe('');
  });

  it('should not modify safe strings', () => {
    expect(esc('hello world')).toBe('hello world');
  });
});
