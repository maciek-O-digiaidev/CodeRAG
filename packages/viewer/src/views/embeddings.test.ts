import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, destroy } from './embeddings.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock requestAnimationFrame for synchronous rendering in tests
let rafCallbacks: Array<FrameRequestCallback> = [];
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
});
vi.stubGlobal('cancelAnimationFrame', () => {});

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

const MOCK_EMBEDDINGS_RESPONSE = {
  data: [
    {
      id: 'chunk-1',
      filePath: 'src/foo.ts',
      chunkType: 'function',
      language: 'typescript',
      vector: [1, 0, 0, 0, 0],
    },
    {
      id: 'chunk-2',
      filePath: 'src/bar.ts',
      chunkType: 'class',
      language: 'typescript',
      vector: [0.9, 0.1, 0, 0, 0],
    },
    {
      id: 'chunk-3',
      filePath: 'lib/baz.py',
      chunkType: 'function',
      language: 'python',
      vector: [0, 0, 1, 0, 0],
    },
    {
      id: 'chunk-4',
      filePath: 'lib/qux.go',
      chunkType: 'method',
      language: 'go',
      vector: [0, 0, 0.9, 0.1, 0],
    },
  ],
};

function setupSuccessMock(): void {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/embeddings')) {
      return Promise.resolve(mockJsonResponse(MOCK_EMBEDDINGS_RESPONSE));
    }
    return Promise.resolve(mockErrorResponse(404, 'Not Found'));
  });
}

function setupEmptyMock(): void {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/embeddings')) {
      return Promise.resolve(mockJsonResponse({ data: [] }));
    }
    return Promise.resolve(mockErrorResponse(404, 'Not Found'));
  });
}

// Provide a minimal getContext mock for canvas (jsdom does not support canvas)
function mockCanvasContext(): void {
  const proto = HTMLCanvasElement.prototype;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (proto as any).getContext = function () {
    return {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      textAlign: 'start',
      textBaseline: 'alphabetic',
      font: '',
    };
  };
}

describe('Embedding Explorer View', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockFetch.mockReset();
    rafCallbacks = [];
    mockCanvasContext();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    destroy();
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should render a canvas element', () => {
    render(container);
    const canvas = container.querySelector('[data-testid="embedding-canvas"]');
    expect(canvas).not.toBeNull();
    expect(canvas?.tagName).toBe('CANVAS');
  });

  it('should render the view header with title', () => {
    render(container);
    const header = container.querySelector('.view-header h2');
    expect(header).not.toBeNull();
    expect(header?.textContent).toBe('Embedding Explorer');
  });

  it('should render the toolbar with all controls', () => {
    render(container);
    const toolbar = container.querySelector('[data-testid="embedding-toolbar"]');
    expect(toolbar).not.toBeNull();
  });

  it('should render the limit input with default value', () => {
    render(container);
    const input = container.querySelector('[data-testid="embedding-limit-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('number');
    expect(input.value).toBe('500');
    expect(input.min).toBe('10');
    expect(input.max).toBe('2000');
  });

  it('should render the color mode select with options', () => {
    render(container);
    const select = container.querySelector('[data-testid="embedding-color-mode"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0]?.value).toBe('language');
    expect(options[1]?.value).toBe('chunkType');
    expect(options[2]?.value).toBe('directory');
  });

  it('should render 2D/3D dimension toggle buttons', () => {
    render(container);
    const btn2d = container.querySelector('[data-testid="embedding-dim-toggle-2d"]') as HTMLButtonElement;
    const btn3d = container.querySelector('[data-testid="embedding-dim-toggle-3d"]') as HTMLButtonElement;
    expect(btn2d).not.toBeNull();
    expect(btn3d).not.toBeNull();
    expect(btn2d.textContent).toBe('2D');
    expect(btn3d.textContent).toBe('3D');
    // 2D should be active by default
    expect(btn2d.classList.contains('embedding-dim-btn--active')).toBe(true);
    expect(btn3d.classList.contains('embedding-dim-btn--active')).toBe(false);
  });

  it('should render the load button', () => {
    render(container);
    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    expect(loadBtn).not.toBeNull();
    expect(loadBtn.textContent).toBe('Load Embeddings');
    expect(loadBtn.disabled).toBe(false);
  });

  it('should render progress bar hidden initially', () => {
    render(container);
    const progress = container.querySelector('[data-testid="embedding-progress"]') as HTMLElement;
    expect(progress).not.toBeNull();
    expect(progress.style.display).toBe('none');
  });

  it('should render initial placeholder message', () => {
    render(container);
    const initial = container.querySelector('[data-testid="embedding-initial"]');
    expect(initial).not.toBeNull();
    expect(initial?.textContent).toContain("Click 'Load Embeddings' to visualize");
  });

  it('should render tooltip element hidden initially', () => {
    render(container);
    const tooltip = container.querySelector('[data-testid="embedding-tooltip"]') as HTMLElement;
    expect(tooltip).not.toBeNull();
    expect(tooltip.style.display).toBe('none');
  });

  it('should render legend container', () => {
    render(container);
    const legend = container.querySelector('[data-testid="embedding-legend"]');
    expect(legend).not.toBeNull();
  });

  it('should show progress bar during loading', async () => {
    // Use a delayed response to observe loading state
    mockFetch.mockImplementation(() => {
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(mockJsonResponse(MOCK_EMBEDDINGS_RESPONSE));
        }, 100);
      });
    });

    render(container);
    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    loadBtn.click();

    // Progress should become visible
    await vi.waitFor(() => {
      const progress = container.querySelector('[data-testid="embedding-progress"]') as HTMLElement;
      expect(progress.style.display).not.toBe('none');
    });
  });

  it('should show error state on API failure', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));
    render(container);

    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    loadBtn.click();

    await vi.waitFor(() => {
      const error = container.querySelector('[data-testid="embedding-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('Failed to load embeddings');
    });
  });

  it('should show empty state when no embeddings returned', async () => {
    setupEmptyMock();
    render(container);

    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    loadBtn.click();

    await vi.waitFor(() => {
      const empty = container.querySelector('[data-testid="embedding-empty"]');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain('No embeddings available');
    });
  });

  it('should load embeddings and render legend', async () => {
    setupSuccessMock();
    render(container);

    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    loadBtn.click();

    await vi.waitFor(() => {
      const legend = container.querySelector('[data-testid="embedding-legend"]');
      expect(legend).not.toBeNull();
      expect(legend?.innerHTML).toContain('embedding-legend-item');
    });
  });

  it('should show point count after loading', async () => {
    setupSuccessMock();
    render(container);

    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    loadBtn.click();

    await vi.waitFor(() => {
      const count = container.querySelector('[data-testid="embedding-point-count"]') as HTMLElement;
      expect(count).not.toBeNull();
      expect(count.textContent).toContain('4 points loaded');
      expect(count.style.display).toBe('block');
    });
  });

  it('should re-enable load button after loading completes', async () => {
    setupSuccessMock();
    render(container);

    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    loadBtn.click();

    await vi.waitFor(() => {
      expect(loadBtn.disabled).toBe(false);
    });
  });

  it('should handle destroy when not rendered', () => {
    expect(() => destroy()).not.toThrow();
  });

  it('should handle destroy after render', () => {
    render(container);
    expect(() => destroy()).not.toThrow();
  });

  it('should handle destroy after data load', async () => {
    setupSuccessMock();
    render(container);

    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    loadBtn.click();

    await vi.waitFor(() => {
      const legend = container.querySelector('[data-testid="embedding-legend"]');
      expect(legend?.innerHTML).toContain('embedding-legend-item');
    });

    expect(() => destroy()).not.toThrow();
  });

  it('should switch dimension toggle from 2D to 3D', () => {
    render(container);

    const btn2d = container.querySelector('[data-testid="embedding-dim-toggle-2d"]') as HTMLButtonElement;
    const btn3d = container.querySelector('[data-testid="embedding-dim-toggle-3d"]') as HTMLButtonElement;

    btn3d.click();

    expect(btn3d.classList.contains('embedding-dim-btn--active')).toBe(true);
    expect(btn2d.classList.contains('embedding-dim-btn--active')).toBe(false);
  });

  it('should render canvas container with correct class', () => {
    render(container);
    const canvasContainer = container.querySelector('[data-testid="embedding-canvas-container"]');
    expect(canvasContainer).not.toBeNull();
    expect(canvasContainer?.classList.contains('embedding-canvas-container')).toBe(true);
  });

  it('should update color mode when select changes', async () => {
    setupSuccessMock();
    render(container);

    // Load data first
    const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement;
    loadBtn.click();

    await vi.waitFor(() => {
      const legend = container.querySelector('[data-testid="embedding-legend"]');
      expect(legend?.innerHTML).toContain('embedding-legend-item');
    });

    // Change color mode
    const select = container.querySelector('[data-testid="embedding-color-mode"]') as HTMLSelectElement;
    select.value = 'chunkType';
    select.dispatchEvent(new Event('change'));

    // Legend should update
    const legend = container.querySelector('[data-testid="embedding-legend"]');
    expect(legend?.innerHTML).toContain('embedding-legend-item');
  });
});
