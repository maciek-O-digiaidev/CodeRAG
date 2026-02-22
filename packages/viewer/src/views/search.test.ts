import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, destroy } from './search.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock performance.now for timing tests
const mockPerformanceNow = vi.fn();
vi.stubGlobal('performance', { now: mockPerformanceNow });

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

const MOCK_SEARCH_RESPONSE = {
  results: [
    { chunkId: 'c1', score: 0.95, filePath: 'src/foo.ts', name: 'fooFunction', kind: 'function', snippet: 'A function that does foo' },
    { chunkId: 'c2', score: 0.80, filePath: 'src/bar.ts', name: 'BarClass', kind: 'class', snippet: 'A class for bar operations' },
    { chunkId: 'c3', score: 0.65, filePath: 'lib/baz.py', name: 'baz_helper', kind: 'function', snippet: 'Helper for baz logic' },
  ],
  query: 'test query',
  totalResults: 3,
  timingMs: 42,
};

function setupSearchMock(): void {
  let callCount = 0;
  mockPerformanceNow.mockImplementation(() => {
    callCount++;
    return callCount % 2 === 1 ? 100 : 150;
  });
  mockFetch.mockResolvedValue(mockJsonResponse(MOCK_SEARCH_RESPONSE));
}

describe('Search Playground View', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockFetch.mockReset();
    mockPerformanceNow.mockReset();
    mockPerformanceNow.mockReturnValue(0);
    window.location.hash = '#/search';
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    destroy();
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should render search input', () => {
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toContain('search query');
  });

  it('should render submit and clear buttons', () => {
    render(container);

    expect(container.querySelector('[data-testid="search-submit"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="search-clear"]')).not.toBeNull();
  });

  it('should render weight sliders with initial values', () => {
    render(container);

    const vectorSlider = container.querySelector('[data-testid="vector-weight-slider"]') as HTMLInputElement;
    const bm25Slider = container.querySelector('[data-testid="bm25-weight-slider"]') as HTMLInputElement;

    expect(vectorSlider).not.toBeNull();
    expect(bm25Slider).not.toBeNull();
    expect(vectorSlider.value).toBe('0.5');
    expect(bm25Slider.value).toBe('0.5');

    const vectorValue = container.querySelector('[data-testid="vector-weight-value"]');
    const bm25Value = container.querySelector('[data-testid="bm25-weight-value"]');
    expect(vectorValue?.textContent).toBe('0.5');
    expect(bm25Value?.textContent).toBe('0.5');
  });

  it('should enforce weight constraint: sliders sum to 1.0', () => {
    render(container);

    const vectorSlider = container.querySelector('[data-testid="vector-weight-slider"]') as HTMLInputElement;
    const bm25Slider = container.querySelector('[data-testid="bm25-weight-slider"]') as HTMLInputElement;

    // Simulate changing vector slider to 0.7
    vectorSlider.value = '0.7';
    vectorSlider.dispatchEvent(new Event('input'));

    expect(bm25Slider.value).toBe('0.3');

    const vectorValue = container.querySelector('[data-testid="vector-weight-value"]');
    const bm25Value = container.querySelector('[data-testid="bm25-weight-value"]');
    expect(vectorValue?.textContent).toBe('0.7');
    expect(bm25Value?.textContent).toBe('0.3');
  });

  it('should enforce weight constraint from BM25 slider side', () => {
    render(container);

    const vectorSlider = container.querySelector('[data-testid="vector-weight-slider"]') as HTMLInputElement;
    const bm25Slider = container.querySelector('[data-testid="bm25-weight-slider"]') as HTMLInputElement;

    // Simulate changing bm25 slider to 0.8
    bm25Slider.value = '0.8';
    bm25Slider.dispatchEvent(new Event('input'));

    expect(vectorSlider.value).toBe('0.2');

    const vectorValue = container.querySelector('[data-testid="vector-weight-value"]');
    const bm25Value = container.querySelector('[data-testid="bm25-weight-value"]');
    expect(vectorValue?.textContent).toBe('0.2');
    expect(bm25Value?.textContent).toBe('0.8');
  });

  it('should trigger search on submit button click', async () => {
    setupSearchMock();
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test query';

    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      const results = container.querySelectorAll('[data-testid="search-result"]');
      expect(results.length).toBe(3);
    });
  });

  it('should trigger search on Enter key', async () => {
    setupSearchMock();
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test query';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('should display search results with scores', async () => {
    setupSearchMock();
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test query';
    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      const results = container.querySelectorAll('[data-testid="search-result"]');
      expect(results.length).toBe(3);
    });

    const scores = container.querySelectorAll('[data-testid="result-score"]');
    expect(scores[0]?.textContent).toBe('0.9500');
    expect(scores[1]?.textContent).toBe('0.8000');
    expect(scores[2]?.textContent).toBe('0.6500');

    const names = container.querySelectorAll('[data-testid="result-name"]');
    expect(names[0]?.textContent).toBe('fooFunction');
    expect(names[1]?.textContent).toBe('BarClass');
    expect(names[2]?.textContent).toBe('baz_helper');
  });

  it('should display rank numbers for each result', async () => {
    setupSearchMock();
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test query';
    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      const ranks = container.querySelectorAll('[data-testid="result-rank"]');
      expect(ranks.length).toBe(3);
      expect(ranks[0]?.textContent).toBe('1');
      expect(ranks[1]?.textContent).toBe('2');
      expect(ranks[2]?.textContent).toBe('3');
    });
  });

  it('should display timing badges after search', async () => {
    setupSearchMock();
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test query';
    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      const timingBadges = container.querySelector('[data-testid="timing-badges"]') as HTMLElement;
      expect(timingBadges.style.display).toBe('flex');
    });

    const serverBadge = container.querySelector('[data-testid="timing-server"]');
    expect(serverBadge?.textContent).toContain('42ms');

    const totalBadge = container.querySelector('[data-testid="timing-total"]');
    expect(totalBadge?.textContent).toContain('Total:');
  });

  it('should display score breakdown bars', async () => {
    setupSearchMock();
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test query';
    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      const bars = container.querySelectorAll('[data-testid="score-bar"]');
      expect(bars.length).toBe(3);
    });

    const vectorBars = container.querySelectorAll('[data-testid="score-bar-vector"]');
    const bm25Bars = container.querySelectorAll('[data-testid="score-bar-bm25"]');
    expect(vectorBars.length).toBe(3);
    expect(bm25Bars.length).toBe(3);
  });

  it('should render topK selector with correct options', () => {
    render(container);

    const select = container.querySelector('[data-testid="topk-select"]') as HTMLSelectElement;
    expect(select).not.toBeNull();

    const options = select.querySelectorAll('option');
    expect(options.length).toBe(4);
    expect(options[0]?.value).toBe('5');
    expect(options[1]?.value).toBe('10');
    expect(options[2]?.value).toBe('20');
    expect(options[3]?.value).toBe('50');
    expect(select.value).toBe('10');
  });

  it('should persist URL state with query and weights', async () => {
    window.location.hash = '#/search?q=hello&vectorWeight=0.7&bm25Weight=0.3&topK=20';
    setupSearchMock();
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    expect(input.value).toBe('hello');

    const vectorSlider = container.querySelector('[data-testid="vector-weight-slider"]') as HTMLInputElement;
    expect(vectorSlider.value).toBe('0.7');

    const bm25Slider = container.querySelector('[data-testid="bm25-weight-slider"]') as HTMLInputElement;
    expect(bm25Slider.value).toBe('0.3');

    const topkSelect = container.querySelector('[data-testid="topk-select"]') as HTMLSelectElement;
    expect(topkSelect.value).toBe('20');
  });

  it('should auto-search when URL has a query', async () => {
    window.location.hash = '#/search?q=existing+query';
    setupSearchMock();
    render(container);

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('should debounce on slider change', () => {
    render(container);

    // Set a query first so slider change triggers search
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test';

    const vectorSlider = container.querySelector('[data-testid="vector-weight-slider"]') as HTMLInputElement;
    vectorSlider.value = '0.7';
    vectorSlider.dispatchEvent(new Event('input'));

    // Search should not happen immediately
    expect(mockFetch).not.toHaveBeenCalled();

    // After debounce period, search should trigger
    vi.advanceTimersByTime(300);
    // The fetch is called in the debounced timeout
  });

  it('should show empty results message when no results found', async () => {
    mockPerformanceNow.mockReturnValue(0);
    mockFetch.mockResolvedValue(mockJsonResponse({
      results: [],
      query: 'obscure query',
      totalResults: 0,
      timingMs: 10,
    }));
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'obscure query';
    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      const noResults = container.querySelector('[data-testid="search-no-results"]');
      expect(noResults).not.toBeNull();
      expect(noResults?.textContent).toContain('No results found');
    });
  });

  it('should show error state when search API fails', async () => {
    mockPerformanceNow.mockReturnValue(0);
    mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'error query';
    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      const error = container.querySelector('[data-testid="search-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('API error');
    });
  });

  it('should clear results and reset state on clear button click', async () => {
    setupSearchMock();
    render(container);

    // First, do a search
    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test query';
    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="search-result"]').length).toBe(3);
    });

    // Now clear
    const clearBtn = container.querySelector('[data-testid="search-clear"]') as HTMLElement;
    clearBtn.click();

    expect(input.value).toBe('');
    const empty = container.querySelector('[data-testid="search-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('Enter a query');

    const vectorSlider = container.querySelector('[data-testid="vector-weight-slider"]') as HTMLInputElement;
    expect(vectorSlider.value).toBe('0.5');
  });

  it('should display snippets for results that have them', async () => {
    setupSearchMock();
    render(container);

    const input = container.querySelector('[data-testid="search-input"]') as HTMLInputElement;
    input.value = 'test query';
    const submitBtn = container.querySelector('[data-testid="search-submit"]') as HTMLElement;
    submitBtn.click();

    await vi.waitFor(() => {
      const snippets = container.querySelectorAll('[data-testid="result-snippet"]');
      expect(snippets.length).toBe(3);
      expect(snippets[0]?.textContent).toContain('A function that does foo');
    });
  });

  it('should show placeholder text before any search', () => {
    render(container);

    const empty = container.querySelector('[data-testid="search-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('Enter a query');
  });

  it('should handle destroy when not rendered', () => {
    expect(() => destroy()).not.toThrow();
  });

  it('should handle destroy after render', () => {
    render(container);
    expect(() => destroy()).not.toThrow();
  });
});
