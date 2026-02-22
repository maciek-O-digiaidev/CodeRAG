import { createApiClient, type EmbeddingPoint } from '../api.js';
import { umap } from '../umap.js';

// --- Color maps ---

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

const TYPE_COLORS: Readonly<Record<string, string>> = {
  function: '#4ade80',
  class: '#3178c6',
  interface: '#a97bff',
  method: '#fbbf24',
  module: '#f87171',
  variable: '#22d3ee',
  type: '#f472b6',
  enum: '#fb923c',
};

const DIRECTORY_PALETTE: ReadonlyArray<string> = [
  '#3178c6', '#4ade80', '#f1e05a', '#f87171', '#a97bff',
  '#00add8', '#fb923c', '#f472b6', '#22d3ee', '#dea584',
  '#b07219', '#178600', '#701516', '#c22d40', '#563d7c',
  '#f05138',
];

const DEFAULT_POINT_COLOR = '#6b7084';

type ColorMode = 'language' | 'chunkType' | 'directory';

// --- View state ---

interface EmbeddingViewState {
  points: EmbeddingPoint[];
  coordinates: number[][];
  nComponents: 2 | 3;
  colorMode: ColorMode;
  maxPoints: number;
  panX: number;
  panY: number;
  zoom: number;
  isDragging: boolean;
  lastMouseX: number;
  lastMouseY: number;
  hoveredIndex: number | null;
  // 3D rotation
  rotX: number;
  rotY: number;
  autoRotate: boolean;
  loading: boolean;
  error: string | null;
}

let state: EmbeddingViewState = createDefaultState();
let cleanupFns: Array<() => void> = [];
let animFrameId: number | null = null;
let rotationFrameId: number | null = null;

function createDefaultState(): EmbeddingViewState {
  return {
    points: [],
    coordinates: [],
    nComponents: 2,
    colorMode: 'language',
    maxPoints: 500,
    panX: 0,
    panY: 0,
    zoom: 1,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    hoveredIndex: null,
    rotX: 0.3,
    rotY: 0,
    autoRotate: true,
    loading: false,
    error: null,
  };
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

function getTopDirectory(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  return parts.length > 0 ? parts[0]! : 'root';
}

function getPointColor(point: EmbeddingPoint, mode: ColorMode, dirMap: Map<string, string>): string {
  switch (mode) {
    case 'language':
      return LANGUAGE_COLORS[point.language.toLowerCase()] ?? DEFAULT_POINT_COLOR;
    case 'chunkType':
      return TYPE_COLORS[point.chunkType.toLowerCase()] ?? DEFAULT_POINT_COLOR;
    case 'directory':
      return dirMap.get(getTopDirectory(point.filePath)) ?? DEFAULT_POINT_COLOR;
  }
}

function buildDirectoryColorMap(points: EmbeddingPoint[]): Map<string, string> {
  const dirs = [...new Set(points.map((p) => getTopDirectory(p.filePath)))].sort();
  const map = new Map<string, string>();
  for (let i = 0; i < dirs.length; i++) {
    map.set(dirs[i]!, DIRECTORY_PALETTE[i % DIRECTORY_PALETTE.length]!);
  }
  return map;
}

function buildLegendItems(
  points: EmbeddingPoint[],
  mode: ColorMode,
  dirMap: Map<string, string>,
): Array<{ label: string; color: string }> {
  const seen = new Map<string, string>();

  for (const point of points) {
    let label: string;
    let color: string;
    switch (mode) {
      case 'language':
        label = point.language.toLowerCase();
        color = LANGUAGE_COLORS[label] ?? DEFAULT_POINT_COLOR;
        break;
      case 'chunkType':
        label = point.chunkType.toLowerCase();
        color = TYPE_COLORS[label] ?? DEFAULT_POINT_COLOR;
        break;
      case 'directory':
        label = getTopDirectory(point.filePath);
        color = dirMap.get(label) ?? DEFAULT_POINT_COLOR;
        break;
    }
    if (!seen.has(label)) {
      seen.set(label, color);
    }
  }

  return [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, color]) => ({ label, color }));
}

// --- 3D projection ---

function project3Dto2D(
  x: number,
  y: number,
  z: number,
  rotX: number,
  rotY: number,
): { px: number; py: number } {
  // Rotate around Y axis
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;

  // Rotate around X axis
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const y1 = y * cosX - z1 * sinX;
  // z2 not needed for projection

  // Simple perspective projection
  const fov = 2.5;
  const scale = fov / (fov + 0.5);

  return { px: x1 * scale, py: y1 * scale };
}

// --- Canvas rendering ---

function drawScatter(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  const { points, coordinates, nComponents, colorMode, panX, panY, zoom, hoveredIndex, rotX, rotY } = state;
  const dirMap = buildDirectoryColorMap(points);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const plotSize = Math.min(canvas.width, canvas.height) * 0.8;

  ctx.translate(centerX + panX, centerY + panY);
  ctx.scale(zoom, zoom);

  const pointRadius = 4;

  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i]!;
    const point = points[i]!;
    const color = getPointColor(point, colorMode, dirMap);

    let screenX: number;
    let screenY: number;

    if (nComponents === 2) {
      screenX = (coord[0]! - 0.5) * plotSize;
      screenY = (coord[1]! - 0.5) * plotSize;
    } else {
      const x3 = (coord[0]! - 0.5) * plotSize;
      const y3 = (coord[1]! - 0.5) * plotSize;
      const z3 = (coord[2]! - 0.5) * plotSize;
      const projected = project3Dto2D(x3, y3, z3, rotX, rotY);
      screenX = projected.px;
      screenY = projected.py;
    }

    ctx.beginPath();
    ctx.arc(screenX, screenY, i === hoveredIndex ? pointRadius + 2 : pointRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = i === hoveredIndex ? 1 : 0.75;
    ctx.fill();

    if (i === hoveredIndex) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function hitTest(
  mx: number,
  my: number,
  canvas: HTMLCanvasElement,
): number | null {
  const { coordinates, nComponents, panX, panY, zoom, rotX, rotY } = state;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const plotSize = Math.min(canvas.width, canvas.height) * 0.8;
  const hitRadius = 8;

  // Check in reverse order (top-most first)
  for (let i = coordinates.length - 1; i >= 0; i--) {
    const coord = coordinates[i]!;
    let screenX: number;
    let screenY: number;

    if (nComponents === 2) {
      screenX = (coord[0]! - 0.5) * plotSize;
      screenY = (coord[1]! - 0.5) * plotSize;
    } else {
      const x3 = (coord[0]! - 0.5) * plotSize;
      const y3 = (coord[1]! - 0.5) * plotSize;
      const z3 = (coord[2]! - 0.5) * plotSize;
      const projected = project3Dto2D(x3, y3, z3, rotX, rotY);
      screenX = projected.px;
      screenY = projected.py;
    }

    // Transform to screen coordinates
    const sx = screenX * zoom + centerX + panX;
    const sy = screenY * zoom + centerY + panY;

    const dx = mx - sx;
    const dy = my - sy;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return i;
    }
  }
  return null;
}

function requestDraw(canvas: HTMLCanvasElement): void {
  if (animFrameId !== null) return;
  animFrameId = requestAnimationFrame(() => {
    animFrameId = null;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawScatter(ctx, canvas);
    }
  });
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
}

// --- Auto rotation for 3D ---

function startAutoRotation(canvas: HTMLCanvasElement): void {
  stopAutoRotation();
  if (state.nComponents !== 3 || !state.autoRotate) return;

  const step = (): void => {
    if (!state.autoRotate || state.nComponents !== 3) return;
    state.rotY += 0.005;
    requestDraw(canvas);
    rotationFrameId = requestAnimationFrame(step);
  };
  rotationFrameId = requestAnimationFrame(step);
}

function stopAutoRotation(): void {
  if (rotationFrameId !== null) {
    cancelAnimationFrame(rotationFrameId);
    rotationFrameId = null;
  }
}

// --- Data loading ---

async function loadEmbeddings(container: HTMLElement): Promise<void> {
  const progressEl = container.querySelector('[data-testid="embedding-progress"]') as HTMLElement | null;
  const progressBar = container.querySelector('.embedding-progress-bar') as HTMLElement | null;
  const progressText = container.querySelector('.embedding-progress-text') as HTMLElement | null;
  const canvasEl = container.querySelector('[data-testid="embedding-canvas"]') as HTMLCanvasElement | null;
  const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement | null;
  const legendEl = container.querySelector('[data-testid="embedding-legend"]') as HTMLElement | null;
  const pointCountEl = container.querySelector('[data-testid="embedding-point-count"]') as HTMLElement | null;

  if (!canvasEl) return;

  state.loading = true;
  state.error = null;
  if (loadBtn) loadBtn.disabled = true;
  if (progressEl) progressEl.style.display = 'block';

  try {
    const api = createApiClient();
    const points = await api.getEmbeddings(state.maxPoints);

    if (points.length === 0) {
      state.loading = false;
      if (progressEl) progressEl.style.display = 'none';
      if (loadBtn) loadBtn.disabled = false;
      renderEmptyState(canvasEl);
      return;
    }

    state.points = points;

    // Extract vectors for UMAP
    const vectors = points.map((p) => p.vector);

    // Run UMAP
    const result = umap(vectors, {
      nComponents: state.nComponents,
      nNeighbors: Math.min(15, points.length - 1),
      minDist: 0.1,
      nEpochs: 200,
      onProgress: (fraction: number) => {
        if (progressBar) progressBar.style.width = `${Math.round(fraction * 100)}%`;
        if (progressText) progressText.textContent = `${Math.round(fraction * 100)}%`;
      },
    });

    state.coordinates = result.coordinates;
    state.loading = false;
    if (progressEl) progressEl.style.display = 'none';
    if (loadBtn) loadBtn.disabled = false;

    // Render legend
    if (legendEl) {
      const dirMap = buildDirectoryColorMap(points);
      const items = buildLegendItems(points, state.colorMode, dirMap);
      legendEl.innerHTML = items
        .map(
          (item) =>
            `<span class="embedding-legend-item">
              <span class="embedding-legend-dot" style="background-color: ${item.color};"></span>
              ${escapeHtml(item.label)}
            </span>`,
        )
        .join('');
    }

    // Show point count
    if (pointCountEl) {
      pointCountEl.textContent = `${points.length} points loaded`;
      pointCountEl.style.display = 'block';
    }

    // Resize and draw
    resizeCanvas(canvasEl);
    requestDraw(canvasEl);

    // Start auto-rotation for 3D
    if (state.nComponents === 3) {
      startAutoRotation(canvasEl);
    }
  } catch (error: unknown) {
    state.loading = false;
    state.error = error instanceof Error ? error.message : String(error);
    if (progressEl) progressEl.style.display = 'none';
    if (loadBtn) loadBtn.disabled = false;
    renderErrorState(canvasEl, state.error);
  }
}

function renderEmptyState(canvas: HTMLCanvasElement): void {
  const container = canvas.parentElement;
  if (!container) return;
  // Add a placeholder overlay
  let overlay = container.querySelector('.embedding-placeholder') as HTMLElement | null;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'embedding-placeholder';
    overlay.setAttribute('data-testid', 'embedding-empty');
    container.appendChild(overlay);
  }
  overlay.innerHTML = '<p>No embeddings available</p>';
  overlay.style.display = 'flex';
}

function renderErrorState(canvas: HTMLCanvasElement, message: string): void {
  const container = canvas.parentElement;
  if (!container) return;
  let overlay = container.querySelector('.embedding-placeholder') as HTMLElement | null;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'embedding-placeholder';
    container.appendChild(overlay);
  }
  overlay.setAttribute('data-testid', 'embedding-error');
  overlay.innerHTML = `
    <div class="dashboard-error">
      <p class="error-title">Failed to load embeddings</p>
      <p class="error-message">${escapeHtml(message)}</p>
    </div>
  `;
  overlay.style.display = 'flex';
}

// --- Event binding ---

function bindCanvasEvents(container: HTMLElement): void {
  const canvasEl = container.querySelector('[data-testid="embedding-canvas"]') as HTMLCanvasElement | null;
  const tooltipEl = container.querySelector('[data-testid="embedding-tooltip"]') as HTMLElement | null;
  if (!canvasEl || !tooltipEl) return;

  const onMouseMove = (e: MouseEvent): void => {
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state.isDragging) {
      const dx = e.clientX - state.lastMouseX;
      const dy = e.clientY - state.lastMouseY;

      if (state.nComponents === 3) {
        state.rotY += dx * 0.005;
        state.rotX += dy * 0.005;
        state.autoRotate = false;
        stopAutoRotation();
      } else {
        state.panX += dx;
        state.panY += dy;
      }

      state.lastMouseX = e.clientX;
      state.lastMouseY = e.clientY;
      requestDraw(canvasEl);
      return;
    }

    const hit = hitTest(x, y, canvasEl);
    state.hoveredIndex = hit;

    if (hit !== null && state.points[hit]) {
      const point = state.points[hit]!;
      tooltipEl.style.display = 'block';
      tooltipEl.style.left = `${x + 12}px`;
      tooltipEl.style.top = `${y + 12}px`;
      tooltipEl.innerHTML = `
        <strong>${escapeHtml(point.id)}</strong>
        <div class="embedding-tooltip-file">${escapeHtml(point.filePath)}</div>
        <div class="embedding-tooltip-meta">${escapeHtml(point.chunkType)} &middot; ${escapeHtml(point.language)}</div>
      `;
      canvasEl.style.cursor = 'pointer';
    } else {
      tooltipEl.style.display = 'none';
      canvasEl.style.cursor = 'crosshair';
    }

    requestDraw(canvasEl);
  };

  const onMouseDown = (e: MouseEvent): void => {
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTest(x, y, canvasEl);
    if (hit !== null && state.points[hit]) {
      // Navigate to chunk detail
      window.location.hash = `#/chunks?id=${encodeURIComponent(state.points[hit]!.id)}`;
      return;
    }

    state.isDragging = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    canvasEl.style.cursor = 'grabbing';
  };

  const onMouseUp = (): void => {
    state.isDragging = false;
    canvasEl.style.cursor = state.hoveredIndex !== null ? 'pointer' : 'crosshair';
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
    state.zoom = Math.max(0.1, Math.min(10, state.zoom * scaleFactor));
    requestDraw(canvasEl);
  };

  const onMouseLeave = (): void => {
    state.hoveredIndex = null;
    state.isDragging = false;
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
  const limitInput = container.querySelector('[data-testid="embedding-limit-input"]') as HTMLInputElement | null;
  const colorSelect = container.querySelector('[data-testid="embedding-color-mode"]') as HTMLSelectElement | null;
  const btn2d = container.querySelector('[data-testid="embedding-dim-toggle-2d"]') as HTMLButtonElement | null;
  const btn3d = container.querySelector('[data-testid="embedding-dim-toggle-3d"]') as HTMLButtonElement | null;
  const loadBtn = container.querySelector('[data-testid="embedding-load-btn"]') as HTMLButtonElement | null;

  const onLimitChange = (): void => {
    if (limitInput) {
      state.maxPoints = Math.max(10, Math.min(2000, parseInt(limitInput.value, 10) || 500));
    }
  };

  const onColorModeChange = (): void => {
    if (colorSelect) {
      state.colorMode = colorSelect.value as ColorMode;
      // Update legend
      const legendEl = container.querySelector('[data-testid="embedding-legend"]') as HTMLElement | null;
      if (legendEl && state.points.length > 0) {
        const dirMap = buildDirectoryColorMap(state.points);
        const items = buildLegendItems(state.points, state.colorMode, dirMap);
        legendEl.innerHTML = items
          .map(
            (item) =>
              `<span class="embedding-legend-item">
                <span class="embedding-legend-dot" style="background-color: ${item.color};"></span>
                ${escapeHtml(item.label)}
              </span>`,
          )
          .join('');
      }
      const canvasEl = container.querySelector('[data-testid="embedding-canvas"]') as HTMLCanvasElement | null;
      if (canvasEl && state.coordinates.length > 0) {
        requestDraw(canvasEl);
      }
    }
  };

  const setDimension = (dim: 2 | 3): void => {
    if (dim === state.nComponents) return;
    state.nComponents = dim;

    // Update button styles
    if (btn2d && btn3d) {
      if (dim === 2) {
        btn2d.classList.add('embedding-dim-btn--active');
        btn3d.classList.remove('embedding-dim-btn--active');
      } else {
        btn3d.classList.add('embedding-dim-btn--active');
        btn2d.classList.remove('embedding-dim-btn--active');
      }
    }

    // If data is loaded, re-run UMAP
    if (state.points.length > 0) {
      state.panX = 0;
      state.panY = 0;
      state.zoom = 1;
      state.rotX = 0.3;
      state.rotY = 0;
      state.autoRotate = true;
      stopAutoRotation();
      void loadEmbeddings(container);
    }
  };

  const on2dClick = (): void => setDimension(2);
  const on3dClick = (): void => setDimension(3);
  const onLoadClick = (): void => {
    if (!state.loading) {
      state.panX = 0;
      state.panY = 0;
      state.zoom = 1;
      state.hoveredIndex = null;
      // Remove any existing overlays
      const canvasContainer = container.querySelector('[data-testid="embedding-canvas"]')?.parentElement;
      const overlay = canvasContainer?.querySelector('.embedding-placeholder');
      if (overlay) overlay.remove();
      void loadEmbeddings(container);
    }
  };

  limitInput?.addEventListener('change', onLimitChange);
  colorSelect?.addEventListener('change', onColorModeChange);
  btn2d?.addEventListener('click', on2dClick);
  btn3d?.addEventListener('click', on3dClick);
  loadBtn?.addEventListener('click', onLoadClick);

  cleanupFns.push(() => {
    limitInput?.removeEventListener('change', onLimitChange);
    colorSelect?.removeEventListener('change', onColorModeChange);
    btn2d?.removeEventListener('click', on2dClick);
    btn3d?.removeEventListener('click', on3dClick);
    loadBtn?.removeEventListener('click', onLoadClick);
  });
}

// --- Public API ---

/**
 * Render the Embedding Explorer view.
 */
export function render(container: HTMLElement): void {
  state = createDefaultState();
  cleanupFns = [];

  container.innerHTML = `
    <div class="view-header">
      <h2>Embedding Explorer</h2>
      <p class="view-subtitle">Explore embedding space with UMAP projections</p>
    </div>
    <div class="embedding-toolbar" data-testid="embedding-toolbar">
      <label class="control-label">
        Max points:
        <input type="number" min="10" max="2000" value="500"
          class="limit-input" data-testid="embedding-limit-input" />
      </label>
      <label class="control-label">
        Color by:
        <select class="filter-select" data-testid="embedding-color-mode">
          <option value="language">Language</option>
          <option value="chunkType">Chunk Type</option>
          <option value="directory">Directory</option>
        </select>
      </label>
      <div class="embedding-dim-toggle" data-testid="embedding-dim-toggle">
        <button class="embedding-dim-btn embedding-dim-btn--active"
          data-testid="embedding-dim-toggle-2d">2D</button>
        <button class="embedding-dim-btn"
          data-testid="embedding-dim-toggle-3d">3D</button>
      </div>
      <button class="btn btn-primary" data-testid="embedding-load-btn">Load Embeddings</button>
    </div>
    <div class="embedding-progress" data-testid="embedding-progress" style="display: none;">
      <div class="embedding-progress-bar" style="width: 0%;"></div>
      <span class="embedding-progress-text">0%</span>
    </div>
    <div class="embedding-canvas-container" data-testid="embedding-canvas-container">
      <canvas data-testid="embedding-canvas"></canvas>
      <div class="embedding-tooltip" data-testid="embedding-tooltip" style="display: none;"></div>
      <div class="embedding-placeholder" data-testid="embedding-initial">
        <p>Click 'Load Embeddings' to visualize</p>
      </div>
    </div>
    <div class="embedding-legend" data-testid="embedding-legend"></div>
    <div class="embedding-point-count" data-testid="embedding-point-count" style="display: none;"></div>
  `;

  bindCanvasEvents(container);
  bindControlEvents(container);
}

/**
 * Cleanup any event listeners or timers.
 */
export function destroy(): void {
  stopAutoRotation();
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  for (const fn of cleanupFns) {
    fn();
  }
  cleanupFns = [];
  state = createDefaultState();
}
