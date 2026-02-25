import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, destroy, formatRelativeTime } from './dashboard.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  } as Response;
}

function mockErrorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
  } as Response;
}

const MOCK_STATS = {
  data: {
    chunkCount: 150,
    fileCount: 42,
    languages: { typescript: 80, python: 50, go: 20 },
    storageBytes: null,
    lastIndexed: new Date(Date.now() - 7200_000).toISOString(), // 2 hours ago
  },
};

// Backend response format — API client unwraps { data, meta } envelope and maps chunkType->kind
const MOCK_CHUNKS = {
  data: [
    { id: '1', filePath: 'a.ts', name: 'foo', chunkType: 'function', language: 'typescript', startLine: 1, endLine: 10, contentPreview: 'function foo() {}' },
    { id: '2', filePath: 'b.ts', name: 'Bar', chunkType: 'class', language: 'typescript', startLine: 1, endLine: 50, contentPreview: 'class Bar {}' },
    { id: '3', filePath: 'c.ts', name: 'baz', chunkType: 'function', language: 'typescript', startLine: 1, endLine: 5, contentPreview: 'function baz() {}' },
    { id: '4', filePath: 'd.ts', name: 'Qux', chunkType: 'interface', language: 'typescript', startLine: 1, endLine: 8, contentPreview: 'interface Qux {}' },
  ],
  meta: { page: 1, pageSize: 1000, total: 4, totalPages: 1 },
};

function setupSuccessMocks(): void {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/stats')) {
      return Promise.resolve(mockJsonResponse(MOCK_STATS));
    }
    if (typeof url === 'string' && url.includes('/chunks')) {
      return Promise.resolve(mockJsonResponse(MOCK_CHUNKS));
    }
    return Promise.resolve(mockErrorResponse(404, 'Not Found'));
  });
}

describe('Dashboard View', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockFetch.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    destroy();
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should render loading state initially', () => {
    // Don't resolve fetch - leave it pending
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(container);

    const loading = container.querySelector('[data-testid="dashboard-loading"]');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toContain('Loading dashboard data');
  });

  it('should render stats cards after data loads', async () => {
    setupSuccessMocks();

    render(container);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="stats-grid"]')).not.toBeNull();
    });

    const chunksCard = container.querySelector('[data-testid="stat-card-chunks"]');
    expect(chunksCard).not.toBeNull();
    expect(chunksCard?.textContent).toContain('150');

    const filesCard = container.querySelector('[data-testid="stat-card-files"]');
    expect(filesCard).not.toBeNull();
    expect(filesCard?.textContent).toContain('42');

    const langsCard = container.querySelector('[data-testid="stat-card-languages"]');
    expect(langsCard).not.toBeNull();
    expect(langsCard?.textContent).toContain('3');
  });

  it('should render last indexed as relative time', async () => {
    setupSuccessMocks();

    render(container);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="stat-card-last-indexed"]')).not.toBeNull();
    });

    const lastIndexed = container.querySelector('[data-testid="stat-card-last-indexed"]');
    expect(lastIndexed?.textContent).toContain('hours ago');
  });

  it('should render language bar chart', async () => {
    setupSuccessMocks();

    render(container);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="language-chart"]')).not.toBeNull();
    });

    const chart = container.querySelector('[data-testid="language-chart"]');
    expect(chart).not.toBeNull();

    // Should have bars for typescript, python, go
    expect(container.querySelector('[data-testid="bar-typescript"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bar-python"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bar-go"]')).not.toBeNull();
  });

  it('should render chunk type donut chart', async () => {
    setupSuccessMocks();

    render(container);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="chunk-type-chart"]')).not.toBeNull();
    });

    const chart = container.querySelector('[data-testid="chunk-type-chart"]');
    expect(chart).not.toBeNull();

    // Should have segments for function, class, interface
    expect(container.querySelector('[data-testid="donut-segment-function"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="donut-segment-class"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="donut-segment-interface"]')).not.toBeNull();
  });

  it('should show error state when API fails', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

    render(container);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dashboard-error"]')).not.toBeNull();
    });

    const error = container.querySelector('[data-testid="dashboard-error"]');
    expect(error?.textContent).toContain('Failed to load dashboard data');
  });

  it('should start auto-refresh interval on render', () => {
    setupSuccessMocks();

    render(container);

    // Interval should be set
    // Advance time by 30 seconds to trigger a refresh
    const initialCallCount = mockFetch.mock.calls.length;
    vi.advanceTimersByTime(30_000);

    // After 30s, should have more fetch calls from the refresh
    expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('should clear interval on destroy', () => {
    setupSuccessMocks();

    render(container);
    destroy();

    const callCountAfterDestroy = mockFetch.mock.calls.length;
    vi.advanceTimersByTime(60_000);

    // No new calls after destroy
    expect(mockFetch.mock.calls.length).toBe(callCountAfterDestroy);
  });

  it('should handle destroy when not rendered', () => {
    // Should not throw
    expect(() => destroy()).not.toThrow();
  });

  it('should handle null lastIndexedAt', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/stats')) {
        return Promise.resolve(mockJsonResponse({
          data: { ...MOCK_STATS.data, lastIndexed: null },
        }));
      }
      if (typeof url === 'string' && url.includes('/chunks')) {
        return Promise.resolve(mockJsonResponse(MOCK_CHUNKS));
      }
      return Promise.resolve(mockErrorResponse(404, 'Not Found'));
    });

    render(container);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="stat-card-last-indexed"]')).not.toBeNull();
    });

    const lastIndexed = container.querySelector('[data-testid="stat-card-last-indexed"]');
    expect(lastIndexed?.textContent).toContain('Never');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-22T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "Just now" for timestamps less than 60 seconds ago', () => {
    const now = new Date('2026-02-22T11:59:30Z').toISOString();
    expect(formatRelativeTime(now)).toBe('Just now');
  });

  it('should return minutes ago', () => {
    const fiveMinAgo = new Date('2026-02-22T11:55:00Z').toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5 minutes ago');
  });

  it('should return singular minute', () => {
    const oneMinAgo = new Date('2026-02-22T11:59:00Z').toISOString();
    expect(formatRelativeTime(oneMinAgo)).toBe('1 minute ago');
  });

  it('should return hours ago', () => {
    const twoHoursAgo = new Date('2026-02-22T10:00:00Z').toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe('2 hours ago');
  });

  it('should return singular hour', () => {
    const oneHourAgo = new Date('2026-02-22T11:00:00Z').toISOString();
    expect(formatRelativeTime(oneHourAgo)).toBe('1 hour ago');
  });

  it('should return days ago', () => {
    const threeDaysAgo = new Date('2026-02-19T12:00:00Z').toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('3 days ago');
  });

  it('should return months ago', () => {
    const twoMonthsAgo = new Date('2025-12-22T12:00:00Z').toISOString();
    expect(formatRelativeTime(twoMonthsAgo)).toBe('2 months ago');
  });

  it('should return years ago', () => {
    const twoYearsAgo = new Date('2024-02-22T12:00:00Z').toISOString();
    expect(formatRelativeTime(twoYearsAgo)).toBe('2 years ago');
  });

  it('should return "Just now" for future timestamps', () => {
    const future = new Date('2026-02-22T13:00:00Z').toISOString();
    expect(formatRelativeTime(future)).toBe('Just now');
  });

  it('should return "Unknown" for invalid dates', () => {
    expect(formatRelativeTime('not-a-date')).toBe('Unknown');
  });
});
