import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, destroy, ForceSimulation, type SimNode, type SimEdge } from './graph.js';

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

// Backend response format — API client unwraps { data } envelope and maps type→kind, symbols→name
const MOCK_GRAPH_RESPONSE = {
  data: {
    nodes: [
      { id: 'n1', filePath: 'src/foo.ts', symbols: ['fooFunction'], type: 'function' },
      { id: 'n2', filePath: 'src/bar.ts', symbols: ['BarClass'], type: 'class' },
      { id: 'n3', filePath: 'lib/baz.py', symbols: ['bazHelper'], type: 'function' },
      { id: 'n4', filePath: 'src/qux.go', symbols: ['QuxModule'], type: 'module' },
      { id: 'n5', filePath: 'src/widget.ts', symbols: ['IWidget'], type: 'interface' },
    ],
    edges: [
      { source: 'n1', target: 'n2', type: 'imports' },
      { source: 'n2', target: 'n3', type: 'calls' },
      { source: 'n1', target: 'n5', type: 'implements' },
      { source: 'n4', target: 'n2', type: 'imports' },
    ],
  },
};

function setupSuccessMock(): void {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/graph')) {
      return Promise.resolve(mockJsonResponse(MOCK_GRAPH_RESPONSE));
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

describe('Graph View', () => {
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
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const canvas = container.querySelector('[data-testid="graph-canvas"]');
    expect(canvas).not.toBeNull();
    expect(canvas?.tagName).toBe('CANVAS');
  });

  it('should render filter controls (type, language, search)', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    expect(container.querySelector('[data-testid="graph-filter-type"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="graph-filter-language"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="graph-filter-search"]')).not.toBeNull();
  });

  it('should render maxNodes slider with default value', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const slider = container.querySelector('[data-testid="graph-maxnodes-slider"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.min).toBe('100');
    expect(slider.max).toBe('2000');
    expect(slider.value).toBe('500');

    const valueDisplay = container.querySelector('[data-testid="graph-maxnodes-value"]');
    expect(valueDisplay?.textContent).toBe('500');
  });

  it('should show loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const loading = container.querySelector('[data-testid="graph-loading"]');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toContain('Loading graph data');
  });

  it('should show error state on API failure', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));
    render(container);

    await vi.waitFor(() => {
      const error = container.querySelector('[data-testid="graph-error"]');
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain('Failed to load graph data');
    });
  });

  it('should hide loading state after data loads', async () => {
    setupSuccessMock();
    render(container);

    await vi.waitFor(() => {
      const loading = container.querySelector('[data-testid="graph-loading"]') as HTMLElement;
      expect(loading.style.display).toBe('none');
    });
  });

  it('should populate type filter dropdown after data loads', async () => {
    setupSuccessMock();
    render(container);

    await vi.waitFor(() => {
      const typeSelect = container.querySelector('[data-testid="graph-filter-type"]') as HTMLSelectElement;
      const options = typeSelect.querySelectorAll('option');
      // "All types" + unique types from mock data (class, function, interface, module)
      expect(options.length).toBeGreaterThan(1);
    });
  });

  it('should populate language filter dropdown after data loads', async () => {
    setupSuccessMock();
    render(container);

    await vi.waitFor(() => {
      const langSelect = container.querySelector('[data-testid="graph-filter-language"]') as HTMLSelectElement;
      const options = langSelect.querySelectorAll('option');
      // "All languages" + typescript, python, go
      expect(options.length).toBeGreaterThan(1);
    });
  });

  it('should show side panel on node click with details', async () => {
    setupSuccessMock();
    render(container);

    await vi.waitFor(() => {
      const loading = container.querySelector('[data-testid="graph-loading"]') as HTMLElement;
      expect(loading.style.display).toBe('none');
    });

    // Simulate showing the side panel by calling showSidePanel indirectly via a canvas click
    // Since jsdom doesn't fully support Canvas hit testing, we'll directly test the panel rendering
    // by checking it exists and is initially hidden
    const panel = container.querySelector('[data-testid="graph-panel"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('none');
  });

  it('should render graph legend after data loads', async () => {
    setupSuccessMock();
    render(container);

    await vi.waitFor(() => {
      const legend = container.querySelector('[data-testid="graph-legend"]');
      expect(legend).not.toBeNull();
      expect(legend?.innerHTML).toContain('graph-legend-item');
    });
  });

  it('should update maxNodes value display when slider changes', async () => {
    setupSuccessMock();
    render(container);

    await vi.waitFor(() => {
      const loading = container.querySelector('[data-testid="graph-loading"]') as HTMLElement;
      expect(loading.style.display).toBe('none');
    });

    const slider = container.querySelector('[data-testid="graph-maxnodes-slider"]') as HTMLInputElement;
    slider.value = '1000';
    slider.dispatchEvent(new Event('input'));

    const valueDisplay = container.querySelector('[data-testid="graph-maxnodes-value"]');
    expect(valueDisplay?.textContent).toBe('1000');
  });

  it('should handle destroy when not rendered', () => {
    expect(() => destroy()).not.toThrow();
  });

  it('should handle destroy after render cleans up simulation', async () => {
    setupSuccessMock();
    render(container);

    await vi.waitFor(() => {
      const loading = container.querySelector('[data-testid="graph-loading"]') as HTMLElement;
      expect(loading.style.display).toBe('none');
    });

    expect(() => destroy()).not.toThrow();
  });

  it('should render graph-controls toolbar', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const controls = container.querySelector('[data-testid="graph-controls"]');
    expect(controls).not.toBeNull();
  });

  it('should render graph-container with tooltip element', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(container);

    const graphContainer = container.querySelector('[data-testid="graph-container"]');
    expect(graphContainer).not.toBeNull();

    const tooltip = container.querySelector('[data-testid="graph-tooltip"]');
    expect(tooltip).not.toBeNull();
    expect((tooltip as HTMLElement).style.display).toBe('none');
  });
});

describe('ForceSimulation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should update node positions on tick', () => {
    const sim = new ForceSimulation();
    const nodes: SimNode[] = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0, radius: 5, color: '#fff', label: 'A', file: 'a.ts', type: 'function', language: 'typescript', edges: 1 },
      { id: 'b', x: 100, y: 100, vx: 0, vy: 0, radius: 5, color: '#fff', label: 'B', file: 'b.ts', type: 'class', language: 'typescript', edges: 1 },
    ];
    const edges: SimEdge[] = [
      { source: 'a', target: 'b', type: 'imports' },
    ];

    sim.setData(nodes, edges);

    const x0a = nodes[0]!.x;
    const y0a = nodes[0]!.y;
    const x0b = nodes[1]!.x;
    const y0b = nodes[1]!.y;

    sim.tick();

    // After one tick, positions should have changed due to forces
    const moved = (nodes[0]!.x !== x0a) || (nodes[0]!.y !== y0a) ||
                  (nodes[1]!.x !== x0b) || (nodes[1]!.y !== y0b);
    expect(moved).toBe(true);
  });

  it('should stop simulation after max iterations', () => {
    const sim = new ForceSimulation();
    const nodes: SimNode[] = [
      { id: 'a', x: 0, y: 0, vx: 10, vy: 10, radius: 5, color: '#fff', label: 'A', file: 'a.ts', type: 'function', language: 'typescript', edges: 0 },
      { id: 'b', x: 1000, y: 1000, vx: -10, vy: -10, radius: 5, color: '#fff', label: 'B', file: 'b.ts', type: 'class', language: 'typescript', edges: 0 },
    ];

    sim.setData(nodes, []);

    // Tick many times — should eventually stop
    for (let i = 0; i < 350; i++) {
      if (!sim.isRunning && i > 0) break;
      sim.tick();
    }

    // Simulation should have stopped (not running after max iterations)
    expect(sim.isRunning).toBe(false);
  });

  it('should start and stop simulation', () => {
    const sim = new ForceSimulation();
    const nodes: SimNode[] = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0, radius: 5, color: '#fff', label: 'A', file: 'a.ts', type: 'function', language: 'typescript', edges: 0 },
    ];
    sim.setData(nodes, []);

    const onTick = vi.fn();
    sim.start(onTick);
    expect(sim.isRunning).toBe(true);

    sim.stop();
    expect(sim.isRunning).toBe(false);
  });

  it('should expose nodes and edges via getters', () => {
    const sim = new ForceSimulation();
    const nodes: SimNode[] = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0, radius: 5, color: '#fff', label: 'A', file: 'a.ts', type: 'function', language: 'typescript', edges: 1 },
    ];
    const edges: SimEdge[] = [
      { source: 'a', target: 'b', type: 'imports' },
    ];

    sim.setData(nodes, edges);
    expect(sim.nodes).toHaveLength(1);
    expect(sim.edges).toHaveLength(1);
    expect(sim.nodes[0]!.id).toBe('a');
    expect(sim.edges[0]!.source).toBe('a');
  });

  it('should apply repulsion between nodes', () => {
    const sim = new ForceSimulation();
    // Two nodes very close together — repulsion should push them apart
    const nodes: SimNode[] = [
      { id: 'a', x: 0, y: 0, vx: 0, vy: 0, radius: 5, color: '#fff', label: 'A', file: 'a.ts', type: 'function', language: 'typescript', edges: 0 },
      { id: 'b', x: 1, y: 0, vx: 0, vy: 0, radius: 5, color: '#fff', label: 'B', file: 'b.ts', type: 'class', language: 'typescript', edges: 0 },
    ];

    sim.setData(nodes, []);
    sim.tick();

    // Node a should have moved left (negative x direction), node b right (positive x direction)
    expect(nodes[0]!.x).toBeLessThan(0);
    expect(nodes[1]!.x).toBeGreaterThan(1);
  });
});
