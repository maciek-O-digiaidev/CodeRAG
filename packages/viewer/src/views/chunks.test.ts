import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, destroy } from './chunks.js';

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

// Backend response format for /chunks — API client unwraps { data, meta } envelope
const MOCK_CHUNKS_PAGE = {
  data: [
    { id: 'c1', filePath: 'src/foo.ts', name: 'fooFunction', chunkType: 'function', language: 'typescript', startLine: 1, endLine: 20 },
    { id: 'c2', filePath: 'src/bar.ts', name: 'BarClass', chunkType: 'class', language: 'typescript', startLine: 5, endLine: 45 },
    { id: 'c3', filePath: 'lib/baz.py', name: 'baz_helper', chunkType: 'function', language: 'python', startLine: 10, endLine: 30 },
  ],
  meta: { page: 1, pageSize: 25, total: 50, totalPages: 2 },
};

// Backend response format for /chunks/:id — API client unwraps { data } envelope
const MOCK_CHUNK_DETAIL = {
  data: {
    id: 'c1',
    filePath: 'src/foo.ts',
    name: 'fooFunction',
    chunkType: 'function',
    language: 'typescript',
    startLine: 1,
    endLine: 20,
    content: 'function fooFunction() {\n  return 42;\n}',
    nlSummary: 'A function that returns 42.',
    metadata: { dependencies: ['barHelper'] },
  },
};

function setupSuccessMocks(): void {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/chunks/')) {
      return Promise.resolve(mockJsonResponse(MOCK_CHUNK_DETAIL));
    }
    if (typeof url === 'string' && url.includes('/chunks')) {
      return Promise.resolve(mockJsonResponse(MOCK_CHUNKS_PAGE));
    }
    return Promise.resolve(mockErrorResponse(404, 'Not Found'));
  });
}

describe('Chunk Browser View', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockFetch.mockReset();
    window.location.hash = '#/chunks';
  });

  afterEach(() => {
    destroy();
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('should render the view header with correct title', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const header = container.querySelector('.view-header h2');
    expect(header).not.toBeNull();
    expect(header?.textContent).toBe('Chunk Browser');
  });

  it('should render filter toolbar with all filter elements', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    expect(container.querySelector('[data-testid="filter-toolbar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="filter-file"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="filter-q"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="filter-language"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="filter-type"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="filter-apply"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="filter-clear"]')).not.toBeNull();
  });

  it('should render table structure with correct columns', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const table = container.querySelector('[data-testid="chunk-table"]');
    expect(table).not.toBeNull();

    const headers = container.querySelectorAll('.data-table th');
    expect(headers.length).toBe(5);
    expect(headers[0]?.textContent).toBe('Name');
    expect(headers[1]?.textContent).toBe('File');
    expect(headers[2]?.textContent).toBe('Language');
    expect(headers[3]?.textContent).toBe('Type');
    expect(headers[4]?.textContent).toBe('Lines');
  });

  it('should render pagination controls', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    expect(container.querySelector('[data-testid="pagination"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pagination-info"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="page-prev"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="page-next"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="page-size-select"]')).not.toBeNull();
  });

  it('should show loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const loading = container.querySelector('[data-testid="chunk-loading"]');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toContain('Loading chunks');
  });

  it('should render chunk rows after data loads', async () => {
    setupSuccessMocks();
    render(container);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="chunk-row"]').length).toBe(3);
    });

    const rows = container.querySelectorAll('[data-testid="chunk-row"]');
    expect(rows[0]?.textContent).toContain('fooFunction');
    expect(rows[0]?.textContent).toContain('src/foo.ts');
    expect(rows[0]?.textContent).toContain('typescript');
    expect(rows[0]?.textContent).toContain('function');
    expect(rows[0]?.textContent).toContain('1-20');
  });

  it('should show pagination info after data loads', async () => {
    setupSuccessMocks();
    render(container);

    await vi.waitFor(() => {
      const info = container.querySelector('[data-testid="pagination-info"]');
      expect(info?.textContent).toContain('Showing 1-25 of 50 chunks');
    });
  });

  it('should update page display after data loads', async () => {
    setupSuccessMocks();
    render(container);

    await vi.waitFor(() => {
      const pageDisplay = container.querySelector('[data-testid="pagination-page"]');
      expect(pageDisplay?.textContent).toContain('Page 1 of 2');
    });
  });

  it('should open detail panel when clicking a row', async () => {
    setupSuccessMocks();
    render(container);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="chunk-row"]').length).toBe(3);
    });

    const firstRow = container.querySelector('[data-testid="chunk-row"]') as HTMLElement;
    firstRow.click();

    await vi.waitFor(() => {
      const panel = container.querySelector('[data-testid="detail-panel"]') as HTMLElement;
      expect(panel.style.display).toBe('block');
    });

    await vi.waitFor(() => {
      const title = container.querySelector('[data-testid="detail-title"]');
      expect(title?.textContent).toBe('fooFunction');
    });
  });

  it('should show code preview in detail panel', async () => {
    setupSuccessMocks();
    render(container);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="chunk-row"]').length).toBe(3);
    });

    const firstRow = container.querySelector('[data-testid="chunk-row"]') as HTMLElement;
    firstRow.click();

    await vi.waitFor(() => {
      const code = container.querySelector('[data-testid="code-preview"]');
      expect(code).not.toBeNull();
      expect(code?.textContent).toContain('function fooFunction()');
    });
  });

  it('should show metadata in detail panel', async () => {
    setupSuccessMocks();
    render(container);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="chunk-row"]').length).toBe(3);
    });

    const firstRow = container.querySelector('[data-testid="chunk-row"]') as HTMLElement;
    firstRow.click();

    await vi.waitFor(() => {
      const metadata = container.querySelector('[data-testid="detail-metadata"]');
      expect(metadata).not.toBeNull();
      expect(metadata?.textContent).toContain('src/foo.ts');
      expect(metadata?.textContent).toContain('typescript');
      expect(metadata?.textContent).toContain('function');
      expect(metadata?.textContent).toContain('1-20');
      expect(metadata?.textContent).toContain('A function that returns 42.');
      expect(metadata?.textContent).toContain('barHelper');
    });
  });

  it('should close detail panel when clicking close button', async () => {
    setupSuccessMocks();
    render(container);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="chunk-row"]').length).toBe(3);
    });

    const firstRow = container.querySelector('[data-testid="chunk-row"]') as HTMLElement;
    firstRow.click();

    await vi.waitFor(() => {
      const panel = container.querySelector('[data-testid="detail-panel"]') as HTMLElement;
      expect(panel.style.display).toBe('block');
    });

    const closeBtn = container.querySelector('[data-testid="detail-close"]') as HTMLElement;
    closeBtn.click();

    const panel = container.querySelector('[data-testid="detail-panel"]') as HTMLElement;
    expect(panel.style.display).toBe('none');
  });

  it('should render page size selector with correct options', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const select = container.querySelector('[data-testid="page-size-select"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(4);
    expect(options[0]?.value).toBe('25');
    expect(options[1]?.value).toBe('50');
    expect(options[2]?.value).toBe('100');
    expect(options[3]?.value).toBe('200');
  });

  it('should parse initial state from URL hash params', () => {
    window.location.hash = '#/chunks?page=2&pageSize=50&language=python&type=function&file=src';
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const fileInput = container.querySelector('[data-testid="filter-file"]') as HTMLInputElement;
    expect(fileInput.value).toBe('src');

    const pageSizeSelect = container.querySelector('[data-testid="page-size-select"]') as HTMLSelectElement;
    expect(pageSizeSelect.value).toBe('50');
  });

  it('should clear all filters when clear button is clicked', async () => {
    setupSuccessMocks();
    window.location.hash = '#/chunks?file=src&q=test';
    render(container);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="chunk-row"]').length).toBe(3);
    });

    const fileInput = container.querySelector('[data-testid="filter-file"]') as HTMLInputElement;
    expect(fileInput.value).toBe('src');

    const clearBtn = container.querySelector('[data-testid="filter-clear"]') as HTMLElement;
    clearBtn.click();

    expect(fileInput.value).toBe('');
    const qInput = container.querySelector('[data-testid="filter-q"]') as HTMLInputElement;
    expect(qInput.value).toBe('');
  });

  it('should show error state when API fails', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));
    render(container);

    await vi.waitFor(() => {
      const error = container.querySelector('[data-testid="chunk-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('API error');
    });
  });

  it('should show empty state when no chunks match', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({
      data: [],
      meta: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
    }));
    render(container);

    await vi.waitFor(() => {
      const empty = container.querySelector('[data-testid="chunk-empty"]');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain('No chunks found');
    });
  });

  it('should disable previous button on first page', async () => {
    setupSuccessMocks();
    render(container);

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="chunk-row"]').length).toBe(3);
    });

    const prevBtn = container.querySelector('[data-testid="page-prev"]') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });

  it('should handle destroy when not rendered', () => {
    expect(() => destroy()).not.toThrow();
  });

  it('should handle destroy after render', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);
    expect(() => destroy()).not.toThrow();
  });
});
