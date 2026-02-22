import { createApiClient, type GraphResponse } from '../api.js';

// --- Language color map ---
const LANGUAGE_COLORS: Readonly<Record<string, string>> = {
  typescript: '#3178c6',
  javascript: '#f1e05a',
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

const DEFAULT_NODE_COLOR = '#6b7084';
const EDGE_COLOR = 'rgba(120, 120, 160, 0.25)';
const EDGE_HIGHLIGHT_COLOR = 'rgba(124, 107, 240, 0.6)';
const DIM_OPACITY = 0.15;
const MIN_NODE_RADIUS = 4;
const MAX_NODE_RADIUS = 18;
const DEFAULT_MAX_NODES = 500;
const LABEL_ZOOM_THRESHOLD = 1.2;

// --- Force simulation constants ---
const REPULSION_STRENGTH = 800;
const ATTRACTION_STRENGTH = 0.005;
const CENTER_STRENGTH = 0.01;
const DAMPING = 0.9;
const MIN_VELOCITY = 0.01;
const MAX_ITERATIONS = 300;
const TICK_INTERVAL_MS = 16;

// --- Types ---

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  label: string;
  file: string;
  type: string;
  language: string;
  edges: number;
}

export interface SimEdge {
  source: string;
  target: string;
  type: string;
}

interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  isDragging: boolean;
  lastMouseX: number;
  lastMouseY: number;
}

interface GraphViewState {
  typeFilter: string;
  languageFilter: string;
  searchQuery: string;
  maxNodes: number;
}

// --- Force Simulation ---

export class ForceSimulation {
  private _nodes: SimNode[] = [];
  private _edges: SimEdge[] = [];
  private running = false;
  private iterationCount = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;

  get nodes(): ReadonlyArray<SimNode> {
    return this._nodes;
  }

  get edges(): ReadonlyArray<SimEdge> {
    return this._edges;
  }

  get isRunning(): boolean {
    return this.running;
  }

  setData(nodes: SimNode[], edges: SimEdge[]): void {
    this._nodes = nodes;
    this._edges = edges;
    this.iterationCount = 0;
  }

  tick(): void {
    const nodes = this._nodes;
    const edges = this._edges;
    const nodeMap = new Map<string, SimNode>();
    for (const n of nodes) {
      nodeMap.set(n.id, n);
    }

    // Center of mass
    let cx = 0;
    let cy = 0;
    for (const n of nodes) {
      cx += n.x;
      cy += n.y;
    }
    if (nodes.length > 0) {
      cx /= nodes.length;
      cy /= nodes.length;
    }

    // Apply repulsion (Barnes-Hut would be better for large N, but simple O(n^2) suffices for <=2000)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) distSq = 1;
        const dist = Math.sqrt(distSq);
        const force = REPULSION_STRENGTH / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Apply attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const fx = dx * ATTRACTION_STRENGTH;
      const fy = dy * ATTRACTION_STRENGTH;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Apply centering force
    for (const n of nodes) {
      n.vx -= (n.x - cx) * CENTER_STRENGTH;
      n.vy -= (n.y - cy) * CENTER_STRENGTH;
    }

    // Update positions with damping
    let totalVelocity = 0;
    for (const n of nodes) {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      totalVelocity += Math.abs(n.vx) + Math.abs(n.vy);
    }

    this.iterationCount++;

    // Check if stable
    const avgVelocity = nodes.length > 0 ? totalVelocity / nodes.length : 0;
    if (avgVelocity < MIN_VELOCITY || this.iterationCount >= MAX_ITERATIONS) {
      this.stop();
    }
  }

  start(onTick: () => void): void {
    if (this.running) return;
    this.running = true;
    this.iterationCount = 0;

    this.timerId = setInterval(() => {
      if (!this.running) {
        if (this.timerId !== null) {
          clearInterval(this.timerId);
          this.timerId = null;
        }
        return;
      }
      this.tick();
      onTick();
      if (!this.running && this.timerId !== null) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}

// --- Helpers ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const extMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    html: 'html',
    css: 'css',
  };
  return extMap[ext] ?? 'unknown';
}

function buildSimData(
  response: GraphResponse,
  maxNodes: number,
): { nodes: SimNode[]; edges: SimEdge[] } {
  // Count edges per node for degree centrality
  const degreeMap = new Map<string, number>();
  for (const edge of response.edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }

  // Sort nodes by degree centrality (most connected first) to keep important ones
  const sortedGraphNodes = [...response.nodes].sort((a, b) => {
    const da = degreeMap.get(a.id) ?? 0;
    const db = degreeMap.get(b.id) ?? 0;
    return db - da;
  });

  const truncated = sortedGraphNodes.slice(0, maxNodes);
  const nodeIdSet = new Set(truncated.map(n => n.id));

  // Compute max degree for scaling
  let maxDegree = 1;
  for (const n of truncated) {
    const d = degreeMap.get(n.id) ?? 0;
    if (d > maxDegree) maxDegree = d;
  }

  // Initial random layout within a bounded area
  const spread = Math.sqrt(truncated.length) * 30;
  const simNodes: SimNode[] = truncated.map(n => {
    const degree = degreeMap.get(n.id) ?? 0;
    const lang = inferLanguage(n.filePath);
    const normalizedDegree = maxDegree > 0 ? degree / maxDegree : 0;
    const radius = MIN_NODE_RADIUS + normalizedDegree * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);

    return {
      id: n.id,
      x: (Math.random() - 0.5) * spread,
      y: (Math.random() - 0.5) * spread,
      vx: 0,
      vy: 0,
      radius,
      color: LANGUAGE_COLORS[lang] ?? DEFAULT_NODE_COLOR,
      label: n.name,
      file: n.filePath,
      type: n.kind,
      language: lang,
      edges: degree,
    };
  });

  // Filter edges to only include nodes in the truncated set
  const simEdges: SimEdge[] = response.edges
    .filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
    .map(e => ({ source: e.source, target: e.target, type: e.kind }));

  return { nodes: simNodes, edges: simEdges };
}

function getFilteredData(
  allNodes: ReadonlyArray<SimNode>,
  allEdges: ReadonlyArray<SimEdge>,
  filters: GraphViewState,
): { nodes: SimNode[]; edges: SimEdge[] } {
  let nodes = [...allNodes];

  if (filters.typeFilter) {
    nodes = nodes.filter(n => n.type === filters.typeFilter);
  }
  if (filters.languageFilter) {
    nodes = nodes.filter(n => n.language === filters.languageFilter);
  }
  if (filters.searchQuery) {
    const q = filters.searchQuery.toLowerCase();
    nodes = nodes.filter(
      n => n.label.toLowerCase().includes(q) || n.file.toLowerCase().includes(q),
    );
  }

  const nodeIdSet = new Set(nodes.map(n => n.id));
  const edges = allEdges.filter(
    e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target),
  );

  return {
    nodes: nodes.map(n => ({ ...n })),
    edges: edges.map(e => ({ ...e })),
  };
}

function getNeighborIds(nodeId: string, edges: ReadonlyArray<SimEdge>): Set<string> {
  const neighbors = new Set<string>();
  neighbors.add(nodeId);
  for (const e of edges) {
    if (e.source === nodeId) neighbors.add(e.target);
    if (e.target === nodeId) neighbors.add(e.source);
  }
  return neighbors;
}

function getNodeConnections(
  nodeId: string,
  edges: ReadonlyArray<SimEdge>,
  nodeMap: ReadonlyMap<string, SimNode>,
): Array<{ name: string; file: string; direction: string; edgeType: string }> {
  const connections: Array<{ name: string; file: string; direction: string; edgeType: string }> = [];
  for (const e of edges) {
    if (e.source === nodeId) {
      const target = nodeMap.get(e.target);
      if (target) {
        connections.push({
          name: target.label,
          file: target.file,
          direction: 'outgoing',
          edgeType: e.type,
        });
      }
    }
    if (e.target === nodeId) {
      const source = nodeMap.get(e.source);
      if (source) {
        connections.push({
          name: source.label,
          file: source.file,
          direction: 'incoming',
          edgeType: e.type,
        });
      }
    }
  }
  return connections;
}

// --- Canvas rendering ---

function drawGraph(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  nodes: ReadonlyArray<SimNode>,
  edges: ReadonlyArray<SimEdge>,
  viewState: ViewState,
): void {
  const nodeMap = new Map<string, SimNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const highlightSet = viewState.selectedNodeId
    ? getNeighborIds(viewState.selectedNodeId, edges)
    : null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(viewState.panX + canvas.width / 2, viewState.panY + canvas.height / 2);
  ctx.scale(viewState.zoom, viewState.zoom);

  // Draw edges
  for (const edge of edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) continue;

    const isHighlighted = highlightSet
      ? highlightSet.has(edge.source) && highlightSet.has(edge.target)
      : false;

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = isHighlighted || !highlightSet ? EDGE_COLOR : `rgba(120, 120, 160, ${DIM_OPACITY * 0.5})`;
    if (isHighlighted) ctx.strokeStyle = EDGE_HIGHLIGHT_COLOR;
    ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
    ctx.stroke();
  }

  // Draw nodes
  for (const node of nodes) {
    const isDimmed = highlightSet && !highlightSet.has(node.id);
    const isHovered = viewState.hoveredNodeId === node.id;
    const isSelected = viewState.selectedNodeId === node.id;

    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);

    if (isDimmed) {
      ctx.globalAlpha = DIM_OPACITY;
    }

    ctx.fillStyle = node.color;
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (isHovered) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  // Draw labels when zoomed in
  if (viewState.zoom >= LABEL_ZOOM_THRESHOLD) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${Math.max(8, 10 / viewState.zoom)}px -apple-system, sans-serif`;

    for (const node of nodes) {
      const isDimmed = highlightSet && !highlightSet.has(node.id);
      if (isDimmed) continue;

      ctx.fillStyle = 'rgba(228, 230, 240, 0.9)';
      ctx.fillText(node.label, node.x, node.y + node.radius + 2);
    }
  }

  ctx.restore();
}

// --- Hit testing ---

function hitTestNode(
  x: number,
  y: number,
  nodes: ReadonlyArray<SimNode>,
  viewState: ViewState,
  canvas: HTMLCanvasElement,
): SimNode | null {
  // Convert screen coords to graph coords
  const graphX = (x - viewState.panX - canvas.width / 2) / viewState.zoom;
  const graphY = (y - viewState.panY - canvas.height / 2) / viewState.zoom;

  // Check in reverse order so topmost nodes are hit first
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i] ?? null;
    if (!node) continue;
    const dx = graphX - node.x;
    const dy = graphY - node.y;
    const hitRadius = node.radius + 2; // slight padding for easier clicks
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return node;
    }
  }
  return null;
}

// --- Unique value extraction ---

function getUniqueTypes(nodes: ReadonlyArray<SimNode>): string[] {
  return [...new Set(nodes.map(n => n.type))].sort();
}

function getUniqueLanguages(nodes: ReadonlyArray<SimNode>): string[] {
  return [...new Set(nodes.map(n => n.language).filter(l => l !== 'unknown'))].sort();
}

// --- Legend ---

function buildLegendHtml(languages: ReadonlyArray<string>): string {
  return languages
    .map(lang => {
      const color = LANGUAGE_COLORS[lang] ?? DEFAULT_NODE_COLOR;
      return `<span class="graph-legend-item">
        <span class="graph-legend-dot" style="background-color: ${color};"></span>
        <span class="graph-legend-label">${escapeHtml(lang)}</span>
      </span>`;
    })
    .join('');
}

// --- Side panel ---

function renderSidePanel(
  node: SimNode,
  connections: ReadonlyArray<{ name: string; file: string; direction: string; edgeType: string }>,
): string {
  const connectionItems = connections.length > 0
    ? connections.map(c => {
        const arrow = c.direction === 'outgoing' ? '&rarr;' : '&larr;';
        return `<li class="graph-panel-connection" data-testid="graph-panel-connection">
          <span class="graph-panel-arrow">${arrow}</span>
          <span class="graph-panel-conn-name">${escapeHtml(c.name)}</span>
          <span class="graph-panel-conn-type">${escapeHtml(c.edgeType)}</span>
        </li>`;
      }).join('')
    : '<li class="graph-panel-no-connections">No connections</li>';

  return `
    <div class="graph-panel-header">
      <h3 class="graph-panel-title" data-testid="graph-panel-title">${escapeHtml(node.label)}</h3>
      <button class="btn graph-panel-close" data-testid="graph-panel-close">Close</button>
    </div>
    <div class="graph-panel-body" data-testid="graph-panel-body">
      <div class="detail-metadata" data-testid="graph-panel-metadata">
        <div class="detail-meta-item">
          <span class="detail-meta-label">File:</span>
          <span class="detail-meta-value">${escapeHtml(node.file)}</span>
        </div>
        <div class="detail-meta-item">
          <span class="detail-meta-label">Language:</span>
          <span class="detail-meta-value">${escapeHtml(node.language)}</span>
        </div>
        <div class="detail-meta-item">
          <span class="detail-meta-label">Type:</span>
          <span class="detail-meta-value">${escapeHtml(node.type)}</span>
        </div>
        <div class="detail-meta-item">
          <span class="detail-meta-label">Connections:</span>
          <span class="detail-meta-value">${node.edges}</span>
        </div>
      </div>
      <div class="graph-panel-section">
        <h4 class="graph-panel-section-title">Dependencies</h4>
        <ul class="graph-panel-connections" data-testid="graph-panel-connections">
          ${connectionItems}
        </ul>
      </div>
      <div class="graph-panel-section">
        <a href="#/chunks?q=${encodeURIComponent(node.label)}" class="btn btn-primary graph-panel-link" data-testid="graph-panel-chunk-link">
          View in Chunk Browser
        </a>
      </div>
    </div>
  `;
}

// --- Main view module state ---

let simulation: ForceSimulation | null = null;
let allSimNodes: SimNode[] = [];
let allSimEdges: SimEdge[] = [];
let filteredNodes: SimNode[] = [];
let filteredEdges: SimEdge[] = [];
let viewState: ViewState = createDefaultViewState();
let graphViewState: GraphViewState = createDefaultGraphViewState();
let cleanupFns: Array<() => void> = [];
let animFrameId: number | null = null;

function createDefaultViewState(): ViewState {
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    hoveredNodeId: null,
    selectedNodeId: null,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
  };
}

function createDefaultGraphViewState(): GraphViewState {
  return {
    typeFilter: '',
    languageFilter: '',
    searchQuery: '',
    maxNodes: DEFAULT_MAX_NODES,
  };
}

/**
 * Render the Dependency Graph view with a force-directed Canvas 2D visualization.
 */
export function render(container: HTMLElement): void {
  viewState = createDefaultViewState();
  graphViewState = createDefaultGraphViewState();

  container.innerHTML = `
    <div class="view-header">
      <h2>Dependency Graph</h2>
      <p class="view-subtitle">Visualize code dependencies and relationships</p>
    </div>
    <div class="graph-controls" data-testid="graph-controls">
      <select class="filter-select" data-testid="graph-filter-type">
        <option value="">All types</option>
      </select>
      <select class="filter-select" data-testid="graph-filter-language">
        <option value="">All languages</option>
      </select>
      <input type="text" class="filter-input" data-testid="graph-filter-search"
        placeholder="Search node..." />
      <label class="control-label" data-testid="graph-maxnodes-label">
        Nodes:
        <input type="range" class="weight-slider" data-testid="graph-maxnodes-slider"
          min="100" max="2000" step="100" value="${DEFAULT_MAX_NODES}" />
        <span class="slider-value" data-testid="graph-maxnodes-value">${DEFAULT_MAX_NODES}</span>
      </label>
    </div>
    <div class="graph-container" data-testid="graph-container">
      <canvas data-testid="graph-canvas"></canvas>
      <div class="graph-tooltip" data-testid="graph-tooltip" style="display: none;"></div>
      <div class="graph-loading" data-testid="graph-loading">
        <div class="spinner"></div>
        <p class="loading-text">Loading graph data...</p>
      </div>
    </div>
    <div class="graph-legend" data-testid="graph-legend"></div>
    <div class="graph-panel" data-testid="graph-panel" style="display: none;"></div>
  `;

  bindCanvasEvents(container);
  bindControlEvents(container);
  void loadGraphData(container);
}

/**
 * Cleanup any event listeners or timers.
 */
export function destroy(): void {
  if (simulation) {
    simulation.stop();
    simulation = null;
  }
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  for (const fn of cleanupFns) {
    fn();
  }
  cleanupFns = [];
  allSimNodes = [];
  allSimEdges = [];
  filteredNodes = [];
  filteredEdges = [];
  viewState = createDefaultViewState();
  graphViewState = createDefaultGraphViewState();
}

// --- Data loading ---

async function loadGraphData(container: HTMLElement): Promise<void> {
  const loadingEl = container.querySelector('[data-testid="graph-loading"]') as HTMLElement | null;
  const canvasEl = container.querySelector('[data-testid="graph-canvas"]') as HTMLCanvasElement | null;
  if (!canvasEl) return;

  try {
    const api = createApiClient();
    const response: GraphResponse = await api.getGraph();

    if (loadingEl) loadingEl.style.display = 'none';

    const { nodes, edges } = buildSimData(response, graphViewState.maxNodes);
    allSimNodes = nodes;
    allSimEdges = edges;

    // Populate filter dropdowns
    populateFilters(container, allSimNodes);

    // Apply filters and start simulation
    applyFiltersAndRestart(container);
  } catch (error: unknown) {
    if (loadingEl) {
      const message = error instanceof Error ? error.message : String(error);
      loadingEl.innerHTML = `
        <div class="graph-error" data-testid="graph-error">
          <p class="error-title">Failed to load graph data</p>
          <p class="error-message">${escapeHtml(message)}</p>
        </div>
      `;
    }
  }
}

function populateFilters(container: HTMLElement, nodes: ReadonlyArray<SimNode>): void {
  const typeSelect = container.querySelector('[data-testid="graph-filter-type"]') as HTMLSelectElement | null;
  const langSelect = container.querySelector('[data-testid="graph-filter-language"]') as HTMLSelectElement | null;

  if (typeSelect) {
    const types = getUniqueTypes(nodes);
    typeSelect.innerHTML = '<option value="">All types</option>' +
      types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  }

  if (langSelect) {
    const langs = getUniqueLanguages(nodes);
    langSelect.innerHTML = '<option value="">All languages</option>' +
      langs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  }

  // Update legend
  const legendEl = container.querySelector('[data-testid="graph-legend"]');
  if (legendEl) {
    const langs = getUniqueLanguages(nodes);
    legendEl.innerHTML = buildLegendHtml(langs);
  }
}

function applyFiltersAndRestart(container: HTMLElement): void {
  const canvasEl = container.querySelector('[data-testid="graph-canvas"]') as HTMLCanvasElement | null;
  if (!canvasEl) return;

  const { nodes, edges } = getFilteredData(allSimNodes, allSimEdges, graphViewState);
  filteredNodes = nodes;
  filteredEdges = edges;

  // Stop previous simulation
  if (simulation) {
    simulation.stop();
  }

  simulation = new ForceSimulation();
  simulation.setData(filteredNodes, filteredEdges);

  // Reset view
  viewState.selectedNodeId = null;
  viewState.hoveredNodeId = null;
  closeSidePanel(container);

  // Resize canvas to container
  resizeCanvas(canvasEl);

  // Start simulation with rendering callback
  simulation.start(() => {
    requestDraw(canvasEl);
  });
}

function requestDraw(canvas: HTMLCanvasElement): void {
  if (animFrameId !== null) return;
  animFrameId = requestAnimationFrame(() => {
    animFrameId = null;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawGraph(ctx, canvas, filteredNodes, filteredEdges, viewState);
    }
  });
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    // Adjust internal tracking to CSS pixels
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
}

// --- Event binding ---

function bindCanvasEvents(container: HTMLElement): void {
  const canvasEl = container.querySelector('[data-testid="graph-canvas"]') as HTMLCanvasElement | null;
  const tooltipEl = container.querySelector('[data-testid="graph-tooltip"]') as HTMLElement | null;
  if (!canvasEl || !tooltipEl) return;

  const onMouseMove = (e: MouseEvent): void => {
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (viewState.isDragging) {
      const dx = e.clientX - viewState.lastMouseX;
      const dy = e.clientY - viewState.lastMouseY;
      viewState.panX += dx;
      viewState.panY += dy;
      viewState.lastMouseX = e.clientX;
      viewState.lastMouseY = e.clientY;
      requestDraw(canvasEl);
      return;
    }

    const hit = hitTestNode(x, y, filteredNodes, viewState, canvasEl);
    viewState.hoveredNodeId = hit ? hit.id : null;
    canvasEl.style.cursor = hit ? 'pointer' : 'grab';

    if (hit) {
      tooltipEl.style.display = 'block';
      tooltipEl.style.left = `${x + 12}px`;
      tooltipEl.style.top = `${y + 12}px`;
      tooltipEl.innerHTML = `
        <strong>${escapeHtml(hit.label)}</strong><br/>
        <span class="graph-tooltip-file">${escapeHtml(hit.file)}</span><br/>
        <span class="graph-tooltip-meta">${escapeHtml(hit.type)} &middot; ${hit.edges} connections</span>
      `;
    } else {
      tooltipEl.style.display = 'none';
    }

    requestDraw(canvasEl);
  };

  const onMouseDown = (e: MouseEvent): void => {
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTestNode(x, y, filteredNodes, viewState, canvasEl);
    if (hit) {
      viewState.selectedNodeId = hit.id;
      showSidePanel(container, hit);
      requestDraw(canvasEl);
    } else {
      viewState.isDragging = true;
      viewState.lastMouseX = e.clientX;
      viewState.lastMouseY = e.clientY;
      canvasEl.style.cursor = 'grabbing';
    }
  };

  const onMouseUp = (): void => {
    viewState.isDragging = false;
    canvasEl.style.cursor = viewState.hoveredNodeId ? 'pointer' : 'grab';
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.1, Math.min(10, viewState.zoom * scaleFactor));

    // Zoom towards mouse position
    const rect = canvasEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - canvasEl.width / 2;
    const mouseY = e.clientY - rect.top - canvasEl.height / 2;

    viewState.panX = mouseX - (mouseX - viewState.panX) * (newZoom / viewState.zoom);
    viewState.panY = mouseY - (mouseY - viewState.panY) * (newZoom / viewState.zoom);
    viewState.zoom = newZoom;

    requestDraw(canvasEl);
  };

  const onMouseLeave = (): void => {
    viewState.hoveredNodeId = null;
    viewState.isDragging = false;
    if (tooltipEl) tooltipEl.style.display = 'none';
    requestDraw(canvasEl);
  };

  canvasEl.addEventListener('mousemove', onMouseMove);
  canvasEl.addEventListener('mousedown', onMouseDown);
  canvasEl.addEventListener('mouseup', onMouseUp);
  canvasEl.addEventListener('wheel', onWheel, { passive: false });
  canvasEl.addEventListener('mouseleave', onMouseLeave);

  cleanupFns.push(() => {
    canvasEl.removeEventListener('mousemove', onMouseMove);
    canvasEl.removeEventListener('mousedown', onMouseDown);
    canvasEl.removeEventListener('mouseup', onMouseUp);
    canvasEl.removeEventListener('wheel', onWheel);
    canvasEl.removeEventListener('mouseleave', onMouseLeave);
  });
}

function bindControlEvents(container: HTMLElement): void {
  const typeSelect = container.querySelector('[data-testid="graph-filter-type"]') as HTMLSelectElement | null;
  const langSelect = container.querySelector('[data-testid="graph-filter-language"]') as HTMLSelectElement | null;
  const searchInput = container.querySelector('[data-testid="graph-filter-search"]') as HTMLInputElement | null;
  const maxNodesSlider = container.querySelector('[data-testid="graph-maxnodes-slider"]') as HTMLInputElement | null;
  const maxNodesValue = container.querySelector('[data-testid="graph-maxnodes-value"]');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const onFilterChange = (): void => {
    graphViewState.typeFilter = typeSelect?.value ?? '';
    graphViewState.languageFilter = langSelect?.value ?? '';
    graphViewState.searchQuery = searchInput?.value.trim() ?? '';
    applyFiltersAndRestart(container);
  };

  const onSearchInput = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onFilterChange, 300);
  };

  const onMaxNodesChange = (): void => {
    const val = parseInt(maxNodesSlider?.value ?? String(DEFAULT_MAX_NODES), 10);
    graphViewState.maxNodes = val;
    if (maxNodesValue) maxNodesValue.textContent = String(val);

    // Rebuild sim data from scratch with new maxNodes
    // We need to re-fetch or re-truncate; for now, just re-truncate from allSimNodes
    // But allSimNodes is already truncated at original maxNodes...
    // Re-apply on next data load. For now, trigger a filter change.
    applyFiltersAndRestart(container);
  };

  typeSelect?.addEventListener('change', onFilterChange);
  langSelect?.addEventListener('change', onFilterChange);
  searchInput?.addEventListener('input', onSearchInput);
  maxNodesSlider?.addEventListener('input', onMaxNodesChange);

  cleanupFns.push(() => {
    typeSelect?.removeEventListener('change', onFilterChange);
    langSelect?.removeEventListener('change', onFilterChange);
    searchInput?.removeEventListener('input', onSearchInput);
    maxNodesSlider?.removeEventListener('input', onMaxNodesChange);
    if (debounceTimer) clearTimeout(debounceTimer);
  });
}

// --- Side panel ---

function showSidePanel(container: HTMLElement, node: SimNode): void {
  const panelEl = container.querySelector('[data-testid="graph-panel"]') as HTMLElement | null;
  if (!panelEl) return;

  const nodeMap = new Map<string, SimNode>();
  for (const n of filteredNodes) {
    nodeMap.set(n.id, n);
  }

  const connections = getNodeConnections(node.id, filteredEdges, nodeMap);
  panelEl.innerHTML = renderSidePanel(node, connections);
  panelEl.style.display = 'block';

  // Bind close button
  const closeBtn = panelEl.querySelector('[data-testid="graph-panel-close"]');
  const onClose = (): void => {
    closeSidePanel(container);
    viewState.selectedNodeId = null;
    const canvasEl = container.querySelector('[data-testid="graph-canvas"]') as HTMLCanvasElement | null;
    if (canvasEl) requestDraw(canvasEl);
  };
  closeBtn?.addEventListener('click', onClose);
  cleanupFns.push(() => closeBtn?.removeEventListener('click', onClose));
}

function closeSidePanel(container: HTMLElement): void {
  const panelEl = container.querySelector('[data-testid="graph-panel"]') as HTMLElement | null;
  if (panelEl) {
    panelEl.style.display = 'none';
  }
}
