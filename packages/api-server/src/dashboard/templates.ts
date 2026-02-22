/**
 * Server-rendered HTML templates for the CodeRAG admin dashboard.
 *
 * All HTML/CSS is inline — no external assets or client-side JS frameworks.
 * Works without JavaScript in the browser (progressive enhancement).
 */

import type {
  DashboardPage,
  FlashMessage,
  IndexOverview,
  SearchAnalytics,
  UserInfo,
  UsageStats,
  DashboardConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OverviewPageData {
  readonly overview: IndexOverview;
  readonly usageStats: UsageStats;
  readonly flash?: FlashMessage;
}

export interface AnalyticsPageData {
  readonly analytics: SearchAnalytics;
}

export interface UsersPageData {
  readonly users: ReadonlyArray<UserInfo>;
}

export interface SettingsPageData {
  readonly config: DashboardConfig;
  readonly projectConfig: {
    readonly name: string;
    readonly embeddingModel: string;
    readonly storagePath: string;
  } | null;
}

export type PageData =
  | { page: 'overview'; data: OverviewPageData }
  | { page: 'analytics'; data: AnalyticsPageData }
  | { page: 'users'; data: UsersPageData }
  | { page: 'settings'; data: SettingsPageData };

/**
 * Render a complete dashboard HTML page.
 */
export function renderDashboardPage(pageData: PageData): string {
  let content: string;
  switch (pageData.page) {
    case 'overview':
      content = renderOverviewContent(pageData.data);
      break;
    case 'analytics':
      content = renderAnalyticsContent(pageData.data);
      break;
    case 'users':
      content = renderUsersContent(pageData.data);
      break;
    case 'settings':
      content = renderSettingsContent(pageData.data);
      break;
  }

  return renderLayout(pageData.page, content);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function renderLayout(activePage: DashboardPage, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CodeRAG Dashboard — ${capitalize(activePage)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="layout">
    <nav class="sidebar" aria-label="Dashboard navigation">
      <div class="sidebar-header">
        <h1 class="logo">CodeRAG</h1>
        <span class="subtitle">Admin Dashboard</span>
      </div>
      <ul class="nav-list">
        ${navItem('overview', 'Overview', activePage)}
        ${navItem('analytics', 'Analytics', activePage)}
        ${navItem('users', 'Users', activePage)}
        ${navItem('settings', 'Settings', activePage)}
      </ul>
    </nav>
    <main class="content">
      ${content}
    </main>
  </div>
</body>
</html>`;
}

function navItem(page: DashboardPage, label: string, activePage: DashboardPage): string {
  const activeClass = page === activePage ? ' class="active"' : '';
  return `<li><a href="/dashboard/${page}"${activeClass}>${esc(label)}</a></li>`;
}

// ---------------------------------------------------------------------------
// Overview Page
// ---------------------------------------------------------------------------

function renderOverviewContent(data: OverviewPageData): string {
  const { overview, usageStats, flash } = data;

  const flashHtml = flash ? renderFlash(flash) : '';

  const healthBadge = renderHealthBadge(overview.health);
  const lastIndexed = overview.lastIndexed
    ? formatTimestamp(overview.lastIndexed)
    : 'Never';
  const languages = overview.languages.length > 0
    ? overview.languages.join(', ')
    : 'None detected';

  return `
    <h2>Index Overview</h2>
    ${flashHtml}
    <div class="card-grid">
      <div class="card">
        <h3>Index Health</h3>
        <div class="card-body">
          ${healthBadge}
          <dl>
            <dt>Chunks</dt><dd>${formatNumber(overview.chunkCount)}</dd>
            <dt>Files</dt><dd>${formatNumber(overview.fileCount)}</dd>
            <dt>Languages</dt><dd>${esc(languages)}</dd>
            <dt>Last Indexed</dt><dd>${esc(lastIndexed)}</dd>
            <dt>Storage</dt><dd>${formatBytes(overview.storageBytes)}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <h3>Usage Summary</h3>
        <div class="card-body">
          <dl>
            <dt>API Calls Today</dt><dd>${formatNumber(usageStats.apiCallsToday)}</dd>
            <dt>API Calls (Week)</dt><dd>${formatNumber(usageStats.apiCallsWeek)}</dd>
            <dt>API Calls (Month)</dt><dd>${formatNumber(usageStats.apiCallsMonth)}</dd>
            <dt>Cost Estimate</dt><dd>${esc(usageStats.costEstimate)}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <h3>Quick Actions</h3>
        <div class="card-body">
          <form method="POST" action="/dashboard/actions/reindex">
            <button type="submit" class="btn btn-primary">Re-index Now</button>
          </form>
          <p class="hint">Triggers a full re-indexing of the project.</p>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Analytics Page
// ---------------------------------------------------------------------------

function renderAnalyticsContent(data: AnalyticsPageData): string {
  const { analytics } = data;

  const chartHtml = renderQueryChart(analytics.queriesPerDay);

  const topQueriesRows = analytics.topQueries.length > 0
    ? analytics.topQueries
        .map(
          (tq, i) =>
            `<tr><td>${i + 1}</td><td>${esc(tq.query)}</td><td>${formatNumber(tq.count)}</td></tr>`,
        )
        .join('\n')
    : '<tr><td colspan="3" class="empty-state">No queries recorded yet.</td></tr>';

  return `
    <h2>Search Analytics</h2>
    <div class="card-grid">
      <div class="card card-wide">
        <h3>Queries Per Day</h3>
        <div class="card-body">
          ${chartHtml}
        </div>
      </div>
      <div class="card">
        <h3>Summary</h3>
        <div class="card-body">
          <dl>
            <dt>Total Queries</dt><dd>${formatNumber(analytics.totalQueries)}</dd>
            <dt>Avg Response Time</dt><dd>${analytics.avgResponseTimeMs.toFixed(1)} ms</dd>
            <dt>Error Rate</dt><dd>${(analytics.errorRate * 100).toFixed(2)}%</dd>
          </dl>
        </div>
      </div>
    </div>
    <div class="card card-wide">
      <h3>Top Queries</h3>
      <div class="card-body">
        <table class="data-table">
          <thead><tr><th>#</th><th>Query</th><th>Count</th></tr></thead>
          <tbody>${topQueriesRows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderQueryChart(queriesPerDay: ReadonlyArray<{ date: string; count: number }>): string {
  if (queriesPerDay.length === 0) {
    return '<p class="empty-state">No query data available.</p>';
  }

  const maxCount = Math.max(...queriesPerDay.map((d) => d.count), 1);

  const bars = queriesPerDay
    .map((day) => {
      const pct = Math.round((day.count / maxCount) * 100);
      return `<div class="bar-group">
        <div class="bar" style="height:${pct}%" title="${esc(day.date)}: ${day.count} queries"></div>
        <span class="bar-label">${esc(day.date.slice(5))}</span>
      </div>`;
    })
    .join('\n');

  return `<div class="chart">${bars}</div>`;
}

// ---------------------------------------------------------------------------
// Users Page
// ---------------------------------------------------------------------------

function renderUsersContent(data: UsersPageData): string {
  const { users } = data;

  if (users.length === 0) {
    return `
      <h2>User Management</h2>
      <div class="card card-wide">
        <div class="card-body">
          <p class="empty-state">No API keys configured. Authentication is disabled.</p>
        </div>
      </div>`;
  }

  const rows = users
    .map(
      (u) =>
        `<tr>
          <td>${esc(u.userId)}</td>
          <td>${renderRoleBadge(u.role)}</td>
          <td>${u.lastActive ? formatTimestamp(u.lastActive) : 'Never'}</td>
          <td>${formatNumber(u.queryCount)}</td>
        </tr>`,
    )
    .join('\n');

  return `
    <h2>User Management</h2>
    <div class="card card-wide">
      <div class="card-body">
        <table class="data-table">
          <thead><tr><th>User ID</th><th>Role</th><th>Last Active</th><th>Queries</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

function renderSettingsContent(data: SettingsPageData): string {
  const { config, projectConfig } = data;

  const projectSection = projectConfig
    ? `<dl>
        <dt>Project Name</dt><dd>${esc(projectConfig.name)}</dd>
        <dt>Embedding Model</dt><dd>${esc(projectConfig.embeddingModel)}</dd>
        <dt>Storage Path</dt><dd>${esc(projectConfig.storagePath)}</dd>
      </dl>`
    : '<p class="empty-state">Project configuration not loaded.</p>';

  return `
    <h2>Settings</h2>
    <div class="card-grid">
      <div class="card">
        <h3>Project Configuration</h3>
        <div class="card-body">
          ${projectSection}
        </div>
      </div>
      <div class="card">
        <h3>Dashboard Configuration</h3>
        <div class="card-body">
          <dl>
            <dt>Max Search Records</dt><dd>${formatNumber(config.maxSearchRecords)}</dd>
            <dt>Max Request Records</dt><dd>${formatNumber(config.maxRequestRecords)}</dd>
            <dt>Top Queries Limit</dt><dd>${formatNumber(config.topQueriesLimit)}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <h3>Re-index</h3>
        <div class="card-body">
          <form method="POST" action="/dashboard/actions/reindex">
            <button type="submit" class="btn btn-primary">Trigger Re-index</button>
          </form>
          <p class="hint">Triggers a full re-indexing of the project.</p>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

function renderFlash(flash: FlashMessage): string {
  return `<div class="flash flash-${esc(flash.type)}" role="alert">${esc(flash.text)}</div>`;
}

function renderHealthBadge(health: IndexOverview['health']): string {
  const colorClass =
    health === 'healthy'
      ? 'badge-green'
      : health === 'degraded'
        ? 'badge-yellow'
        : 'badge-red';

  return `<span class="badge ${colorClass}">${esc(health)}</span>`;
}

function renderRoleBadge(role: 'admin' | 'user'): string {
  const colorClass = role === 'admin' ? 'badge-purple' : 'badge-blue';
  return `<span class="badge ${colorClass}">${esc(role)}</span>`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]!}`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Inline CSS
// ---------------------------------------------------------------------------

const CSS = `
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface-hover: #242736;
    --border: #2e3142;
    --text: #e4e4e7;
    --text-muted: #9ca3af;
    --primary: #6366f1;
    --primary-hover: #818cf8;
    --green: #22c55e;
    --yellow: #eab308;
    --red: #ef4444;
    --purple: #a855f7;
    --blue: #3b82f6;
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --mono: 'SF Mono', 'Fira Code', monospace;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
  }

  .layout {
    display: flex;
    min-height: 100vh;
  }

  /* Sidebar */
  .sidebar {
    width: 240px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 1.5rem 0;
    flex-shrink: 0;
  }

  .sidebar-header {
    padding: 0 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .logo {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--primary);
  }

  .subtitle {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }

  .nav-list {
    list-style: none;
    padding: 1rem 0;
  }

  .nav-list li a {
    display: block;
    padding: 0.6rem 1.25rem;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.9rem;
    transition: background 0.15s, color 0.15s;
  }

  .nav-list li a:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .nav-list li a.active {
    color: var(--primary);
    background: var(--surface-hover);
    border-left: 3px solid var(--primary);
    font-weight: 600;
  }

  /* Content */
  .content {
    flex: 1;
    padding: 2rem;
    max-width: 1200px;
  }

  .content h2 {
    font-size: 1.5rem;
    margin-bottom: 1.5rem;
  }

  /* Cards */
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .card-wide {
    grid-column: 1 / -1;
  }

  .card h3 {
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .card-body {
    padding: 1.25rem;
  }

  /* Definition lists */
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5rem 1rem;
  }

  dt {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  dd {
    font-weight: 500;
  }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .badge-green { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-yellow { background: rgba(234,179,8,0.15); color: var(--yellow); }
  .badge-red { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-purple { background: rgba(168,85,247,0.15); color: var(--purple); }
  .badge-blue { background: rgba(59,130,246,0.15); color: var(--blue); }

  /* Tables */
  .data-table {
    width: 100%;
    border-collapse: collapse;
  }

  .data-table th, .data-table td {
    text-align: left;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .data-table th {
    font-size: 0.8rem;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 600;
  }

  .data-table tbody tr:hover {
    background: var(--surface-hover);
  }

  /* Chart */
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 160px;
    padding-top: 1rem;
  }

  .bar-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }

  .bar {
    width: 100%;
    max-width: 32px;
    background: var(--primary);
    border-radius: 3px 3px 0 0;
    min-height: 2px;
    transition: background 0.15s;
  }

  .bar:hover {
    background: var(--primary-hover);
  }

  .bar-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    margin-top: 0.3rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  /* Buttons */
  .btn {
    display: inline-block;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-primary {
    background: var(--primary);
    color: #fff;
  }

  .btn-primary:hover {
    background: var(--primary-hover);
  }

  /* Flash messages */
  .flash {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1.25rem;
    font-size: 0.9rem;
  }

  .flash-success { background: rgba(34,197,94,0.15); color: var(--green); border: 1px solid rgba(34,197,94,0.3); }
  .flash-error { background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }
  .flash-info { background: rgba(59,130,246,0.15); color: var(--blue); border: 1px solid rgba(59,130,246,0.3); }

  /* Misc */
  .empty-state {
    color: var(--text-muted);
    font-style: italic;
    padding: 1rem 0;
  }

  .hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.75rem;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border); }
    .nav-list { display: flex; flex-wrap: wrap; padding: 0.5rem; }
    .nav-list li a { padding: 0.4rem 0.75rem; }
    .content { padding: 1rem; }
    .card-grid { grid-template-columns: 1fr; }
  }
`;
