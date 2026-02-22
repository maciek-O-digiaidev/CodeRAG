import { createApiClient, type StatsResponse, type ChunkSummary } from '../api.js';

const REFRESH_INTERVAL_MS = 30_000;
const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#f7df1e',
  python: '#3572a5',
  go: '#00add8',
  rust: '#dea584',
  java: '#b07219',
  c: '#555555',
  cpp: '#f34b7d',
  csharp: '#178600',
  ruby: '#701516',
  php: '#4f5d95',
  swift: '#f05138',
  kotlin: '#a97bff',
  scala: '#c22d40',
  html: '#e34c26',
  css: '#563d7c',
};

const CHUNK_TYPE_COLORS: ReadonlyArray<string> = [
  '#7c6bf0', '#4ade80', '#fbbf24', '#f87171', '#38bdf8',
  '#fb923c', '#a78bfa', '#f472b6', '#34d399', '#facc15',
];

let refreshInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Render the Dashboard view with live stats, charts, and auto-refresh.
 */
export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="view-header">
      <h2>Dashboard</h2>
      <p class="view-subtitle">Index overview and health metrics</p>
    </div>
    <div class="dashboard-content" data-testid="dashboard-content">
      <div class="dashboard-loading" data-testid="dashboard-loading">
        <div class="spinner"></div>
        <p class="loading-text">Loading dashboard data...</p>
      </div>
    </div>
  `;

  void loadDashboard(container);
  refreshInterval = setInterval(() => void loadDashboard(container), REFRESH_INTERVAL_MS);
}

/**
 * Cleanup timers on view switch.
 */
export function destroy(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

async function loadDashboard(container: HTMLElement): Promise<void> {
  const contentEl = container.querySelector('[data-testid="dashboard-content"]');
  if (!contentEl) return;

  try {
    const api = createApiClient();
    const stats = await api.getStats();

    // Fetch chunks to compute kind distribution (up to 1000 for overview)
    let chunkKinds: Record<string, number> = {};
    try {
      const chunksPage = await api.getChunks({ limit: 1000, offset: 0 });
      chunkKinds = aggregateChunkKinds(chunksPage.items);
    } catch {
      // If chunks fetch fails, show stats without chart
    }

    contentEl.innerHTML = `
      ${renderStatsCards(stats)}
      <div class="dashboard-charts">
        <div class="chart-section">
          <h3 class="chart-title">Language Distribution</h3>
          ${renderLanguageChart(stats.languages)}
        </div>
        <div class="chart-section">
          <h3 class="chart-title">Chunk Type Distribution</h3>
          ${renderChunkTypeChart(chunkKinds)}
        </div>
      </div>
    `;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    contentEl.innerHTML = `
      <div class="dashboard-error" data-testid="dashboard-error">
        <p class="error-title">Failed to load dashboard data</p>
        <p class="error-message">${escapeHtml(message)}</p>
      </div>
    `;
  }
}

function renderStatsCards(data: StatsResponse): string {
  const languageCount = Object.keys(data.languages).length;
  const lastIndexed = data.lastIndexedAt
    ? formatRelativeTime(data.lastIndexedAt)
    : 'Never';

  return `
    <div class="stats-grid" data-testid="stats-grid">
      <div class="stat-card" data-testid="stat-card-chunks">
        <span class="stat-icon">&#x1F4E6;</span>
        <span class="stat-value">${formatNumber(data.totalChunks)}</span>
        <span class="stat-label">Total Chunks</span>
      </div>
      <div class="stat-card" data-testid="stat-card-files">
        <span class="stat-icon">&#x1F4C4;</span>
        <span class="stat-value">${formatNumber(data.totalFiles)}</span>
        <span class="stat-label">Total Files</span>
      </div>
      <div class="stat-card" data-testid="stat-card-languages">
        <span class="stat-icon">&#x1F310;</span>
        <span class="stat-value">${languageCount}</span>
        <span class="stat-label">Languages</span>
      </div>
      <div class="stat-card" data-testid="stat-card-last-indexed">
        <span class="stat-icon">&#x23F1;</span>
        <span class="stat-value stat-value--small">${escapeHtml(lastIndexed)}</span>
        <span class="stat-label">Last Indexed</span>
      </div>
    </div>
  `;
}

function renderLanguageChart(languages: Record<string, number>): string {
  const entries = Object.entries(languages).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) {
    return '<p class="no-data">No language data available</p>';
  }

  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const maxCount = entries[0]?.[1] ?? 1;

  const bars = entries.map(([lang, count]) => {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    const widthPct = maxCount > 0 ? ((count / maxCount) * 100).toFixed(1) : '0';
    const color = LANGUAGE_COLORS[lang] ?? '#6b7084';
    return `
      <div class="bar-chart-row">
        <span class="bar-label">${escapeHtml(lang)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${widthPct}%; background-color: ${color};" data-testid="bar-${lang}"></div>
        </div>
        <span class="bar-value">${count} (${pct}%)</span>
      </div>
    `;
  }).join('');

  return `<div class="bar-chart" data-testid="language-chart">${bars}</div>`;
}

function renderChunkTypeChart(kinds: Record<string, number>): string {
  const entries = Object.entries(kinds).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) {
    return '<p class="no-data">No chunk type data available</p>';
  }

  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) {
    return '<p class="no-data">No chunk type data available</p>';
  }

  // Build SVG donut chart
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = entries.map(([kind, count], i) => {
    const pct = count / total;
    const dashLength = pct * circumference;
    const dashGap = circumference - dashLength;
    const color = CHUNK_TYPE_COLORS[i % CHUNK_TYPE_COLORS.length];
    const segment = `
      <circle
        cx="80" cy="80" r="${radius}"
        fill="none"
        stroke="${color}"
        stroke-width="24"
        stroke-dasharray="${dashLength} ${dashGap}"
        stroke-dashoffset="${-offset}"
        data-testid="donut-segment-${kind}"
      />
    `;
    offset += dashLength;
    return segment;
  }).join('');

  const legendItems = entries.map(([kind, count], i) => {
    const pct = ((count / total) * 100).toFixed(1);
    const color = CHUNK_TYPE_COLORS[i % CHUNK_TYPE_COLORS.length];
    return `
      <div class="legend-item">
        <span class="legend-color" style="background-color: ${color};"></span>
        <span class="legend-label">${escapeHtml(kind)}</span>
        <span class="legend-value">${count} (${pct}%)</span>
      </div>
    `;
  }).join('');

  return `
    <div class="donut-chart-container" data-testid="chunk-type-chart">
      <svg class="donut-chart" viewBox="0 0 160 160" width="160" height="160">
        ${segments}
        <text x="80" y="76" text-anchor="middle" class="donut-total-value">${formatNumber(total)}</text>
        <text x="80" y="94" text-anchor="middle" class="donut-total-label">chunks</text>
      </svg>
      <div class="donut-legend">${legendItems}</div>
    </div>
  `;
}

function aggregateChunkKinds(chunks: ReadonlyArray<ChunkSummary>): Record<string, number> {
  const kinds: Record<string, number> = {};
  for (const chunk of chunks) {
    kinds[chunk.kind] = (kinds[chunk.kind] ?? 0) + 1;
  }
  return kinds;
}

/**
 * Format an ISO timestamp as a human-readable relative time string.
 */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (Number.isNaN(diffMs)) return 'Unknown';
  if (diffMs < 0) return 'Just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
