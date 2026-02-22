import { createApiClient, type ChunkSummary, type ChunkDetail, type ChunkQueryParams } from '../api.js';
import { parseHash, navigate } from '../router.js';

interface ChunkBrowserState {
  page: number;
  pageSize: number;
  language: string;
  type: string;
  file: string;
  q: string;
  selectedChunkId: string | null;
}

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES: ReadonlyArray<number> = [25, 50, 100, 200];

let state: ChunkBrowserState = createDefaultState();
let abortController: AbortController | null = null;
let cleanupFns: Array<() => void> = [];

function createDefaultState(): ChunkBrowserState {
  return {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    language: '',
    type: '',
    file: '',
    q: '',
    selectedChunkId: null,
  };
}

function parseStateFromHash(): ChunkBrowserState {
  const route = parseHash(window.location.hash);
  return {
    page: Math.max(1, parseInt(route.params['page'] ?? '1', 10) || 1),
    pageSize: PAGE_SIZES.includes(parseInt(route.params['pageSize'] ?? '', 10))
      ? parseInt(route.params['pageSize'] ?? '', 10)
      : DEFAULT_PAGE_SIZE,
    language: route.params['language'] ?? '',
    type: route.params['type'] ?? '',
    file: route.params['file'] ?? '',
    q: route.params['q'] ?? '',
    selectedChunkId: route.params['chunkId'] ?? null,
  };
}

function stateToParams(s: ChunkBrowserState): Record<string, string> {
  const params: Record<string, string> = {};
  if (s.page > 1) params['page'] = String(s.page);
  if (s.pageSize !== DEFAULT_PAGE_SIZE) params['pageSize'] = String(s.pageSize);
  if (s.language) params['language'] = s.language;
  if (s.type) params['type'] = s.type;
  if (s.file) params['file'] = s.file;
  if (s.q) params['q'] = s.q;
  if (s.selectedChunkId) params['chunkId'] = s.selectedChunkId;
  return params;
}

function updateUrl(): void {
  navigate('chunks', stateToParams(state));
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the Chunk Browser view with paginated table, filters, and detail panel.
 */
export function render(container: HTMLElement): void {
  state = parseStateFromHash();

  container.innerHTML = `
    <div class="view-header">
      <h2>Chunk Browser</h2>
      <p class="view-subtitle">Browse and inspect indexed code chunks</p>
    </div>
    <div class="filter-toolbar" data-testid="filter-toolbar">
      <input type="text" class="filter-input" data-testid="filter-file"
        placeholder="Filter by file path..." value="${escapeHtml(state.file)}" />
      <input type="text" class="filter-input filter-input--search" data-testid="filter-q"
        placeholder="Search text..." value="${escapeHtml(state.q)}" />
      <select class="filter-select" data-testid="filter-language">
        <option value="">All languages</option>
      </select>
      <select class="filter-select" data-testid="filter-type">
        <option value="">All types</option>
      </select>
      <button class="btn btn-primary" data-testid="filter-apply">Apply</button>
      <button class="btn" data-testid="filter-clear">Clear</button>
    </div>
    <div class="table-container" data-testid="table-container">
      <table class="data-table chunk-table" data-testid="chunk-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>File</th>
            <th>Language</th>
            <th>Type</th>
            <th>Lines</th>
          </tr>
        </thead>
        <tbody data-testid="chunk-tbody">
          <tr>
            <td colspan="5" class="loading-text" data-testid="chunk-loading">Loading chunks...</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" data-testid="pagination">
      <span class="pagination-info" data-testid="pagination-info"></span>
      <div class="pagination-controls">
        <button class="btn" data-testid="page-prev" disabled>Previous</button>
        <span class="pagination-page" data-testid="pagination-page">Page 1</span>
        <button class="btn" data-testid="page-next" disabled>Next</button>
        <select class="filter-select page-size-select" data-testid="page-size-select">
          ${PAGE_SIZES.map(s => `<option value="${s}" ${s === state.pageSize ? 'selected' : ''}>${s} per page</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="detail-panel" data-testid="detail-panel" style="display: none;">
      <div class="detail-panel-header">
        <h3 class="detail-panel-title" data-testid="detail-title"></h3>
        <button class="btn detail-panel-close" data-testid="detail-close">Close</button>
      </div>
      <div class="detail-panel-body" data-testid="detail-body"></div>
    </div>
  `;

  bindEvents(container);
  void loadChunks(container);
}

function bindEvents(container: HTMLElement): void {
  const applyBtn = container.querySelector('[data-testid="filter-apply"]');
  const clearBtn = container.querySelector('[data-testid="filter-clear"]');
  const prevBtn = container.querySelector('[data-testid="page-prev"]');
  const nextBtn = container.querySelector('[data-testid="page-next"]');
  const pageSizeSelect = container.querySelector('[data-testid="page-size-select"]') as HTMLSelectElement | null;
  const closeBtn = container.querySelector('[data-testid="detail-close"]');
  const fileInput = container.querySelector('[data-testid="filter-file"]') as HTMLInputElement | null;
  const qInput = container.querySelector('[data-testid="filter-q"]') as HTMLInputElement | null;

  const onApply = (): void => {
    readFilterInputs(container);
    state.page = 1;
    updateUrl();
    void loadChunks(container);
  };

  const onClear = (): void => {
    state = createDefaultState();
    if (fileInput) fileInput.value = '';
    if (qInput) qInput.value = '';
    const langSelect = container.querySelector('[data-testid="filter-language"]') as HTMLSelectElement | null;
    const typeSelect = container.querySelector('[data-testid="filter-type"]') as HTMLSelectElement | null;
    if (langSelect) langSelect.value = '';
    if (typeSelect) typeSelect.value = '';
    updateUrl();
    void loadChunks(container);
  };

  const onPrev = (): void => {
    if (state.page > 1) {
      state.page--;
      updateUrl();
      void loadChunks(container);
    }
  };

  const onNext = (): void => {
    state.page++;
    updateUrl();
    void loadChunks(container);
  };

  const onPageSizeChange = (): void => {
    if (pageSizeSelect) {
      state.pageSize = parseInt(pageSizeSelect.value, 10);
      state.page = 1;
      updateUrl();
      void loadChunks(container);
    }
  };

  const onClose = (): void => {
    closeDetailPanel(container);
  };

  const onKeyDown = (e: Event): void => {
    if ((e as KeyboardEvent).key === 'Enter') {
      onApply();
    }
  };

  applyBtn?.addEventListener('click', onApply);
  clearBtn?.addEventListener('click', onClear);
  prevBtn?.addEventListener('click', onPrev);
  nextBtn?.addEventListener('click', onNext);
  pageSizeSelect?.addEventListener('change', onPageSizeChange);
  closeBtn?.addEventListener('click', onClose);
  fileInput?.addEventListener('keydown', onKeyDown);
  qInput?.addEventListener('keydown', onKeyDown);

  cleanupFns.push(() => {
    applyBtn?.removeEventListener('click', onApply);
    clearBtn?.removeEventListener('click', onClear);
    prevBtn?.removeEventListener('click', onPrev);
    nextBtn?.removeEventListener('click', onNext);
    pageSizeSelect?.removeEventListener('change', onPageSizeChange);
    closeBtn?.removeEventListener('click', onClose);
    fileInput?.removeEventListener('keydown', onKeyDown);
    qInput?.removeEventListener('keydown', onKeyDown);
  });
}

function readFilterInputs(container: HTMLElement): void {
  const fileInput = container.querySelector('[data-testid="filter-file"]') as HTMLInputElement | null;
  const qInput = container.querySelector('[data-testid="filter-q"]') as HTMLInputElement | null;
  const langSelect = container.querySelector('[data-testid="filter-language"]') as HTMLSelectElement | null;
  const typeSelect = container.querySelector('[data-testid="filter-type"]') as HTMLSelectElement | null;

  state.file = fileInput?.value.trim() ?? '';
  state.q = qInput?.value.trim() ?? '';
  state.language = langSelect?.value ?? '';
  state.type = typeSelect?.value ?? '';
}

async function loadChunks(container: HTMLElement): Promise<void> {
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  const tbody = container.querySelector('[data-testid="chunk-tbody"]');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" class="loading-text" data-testid="chunk-loading">Loading chunks...</td></tr>`;

  const params: ChunkQueryParams = {
    offset: (state.page - 1) * state.pageSize,
    limit: state.pageSize,
  };
  if (state.language) params.language = state.language;
  if (state.type) params.kind = state.type;
  if (state.file) params.filePath = state.file;

  try {
    const api = createApiClient();
    const response = await api.getChunks(params);

    const total = response.total;
    const start = response.offset + 1;
    const end = Math.min(response.offset + response.limit, total);

    renderTableBody(container, response.items);
    updatePagination(container, start, end, total);

    // If a chunk was selected from URL, open its detail
    if (state.selectedChunkId) {
      void loadChunkDetail(container, state.selectedChunkId);
    }
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    const message = error instanceof Error ? error.message : String(error);
    tbody.innerHTML = `<tr><td colspan="5" class="error-message" data-testid="chunk-error">${escapeHtml(message)}</td></tr>`;
  }
}

function renderTableBody(container: HTMLElement, items: ReadonlyArray<ChunkSummary>): void {
  const tbody = container.querySelector('[data-testid="chunk-tbody"]');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="placeholder-text" data-testid="chunk-empty">No chunks found matching the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(chunk => `
    <tr class="chunk-row" data-chunk-id="${escapeHtml(chunk.id)}" data-testid="chunk-row">
      <td class="chunk-name">${escapeHtml(chunk.name)}</td>
      <td class="chunk-file">${escapeHtml(chunk.filePath)}</td>
      <td class="chunk-language">${escapeHtml(chunk.language)}</td>
      <td class="chunk-type">${escapeHtml(chunk.kind)}</td>
      <td class="chunk-lines">${chunk.startLine}-${chunk.endLine}</td>
    </tr>
  `).join('');

  // Bind row click events
  const rows = tbody.querySelectorAll('[data-testid="chunk-row"]');
  rows.forEach(row => {
    const onClick = (): void => {
      const chunkId = row.getAttribute('data-chunk-id');
      if (chunkId) {
        state.selectedChunkId = chunkId;
        updateUrl();
        void loadChunkDetail(container, chunkId);
      }
    };
    row.addEventListener('click', onClick);
    cleanupFns.push(() => row.removeEventListener('click', onClick));
  });
}

function updatePagination(container: HTMLElement, start: number, end: number, total: number): void {
  const info = container.querySelector('[data-testid="pagination-info"]');
  const pageDisplay = container.querySelector('[data-testid="pagination-page"]');
  const prevBtn = container.querySelector('[data-testid="page-prev"]') as HTMLButtonElement | null;
  const nextBtn = container.querySelector('[data-testid="page-next"]') as HTMLButtonElement | null;

  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  if (info) {
    info.textContent = total > 0
      ? `Showing ${start}-${end} of ${total} chunks`
      : 'No chunks found';
  }
  if (pageDisplay) {
    pageDisplay.textContent = `Page ${state.page} of ${totalPages}`;
  }
  if (prevBtn) {
    prevBtn.disabled = state.page <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = state.page >= totalPages;
  }
}

async function loadChunkDetail(container: HTMLElement, chunkId: string): Promise<void> {
  const panel = container.querySelector('[data-testid="detail-panel"]') as HTMLElement | null;
  const title = container.querySelector('[data-testid="detail-title"]');
  const body = container.querySelector('[data-testid="detail-body"]');
  if (!panel || !title || !body) return;

  panel.style.display = 'block';
  title.textContent = 'Loading...';
  body.innerHTML = '<div class="spinner"></div>';

  try {
    const api = createApiClient();
    const detail: ChunkDetail = await api.getChunk(chunkId);

    title.textContent = detail.name;
    body.innerHTML = `
      <div class="detail-metadata" data-testid="detail-metadata">
        <div class="detail-meta-item">
          <span class="detail-meta-label">File:</span>
          <span class="detail-meta-value">${escapeHtml(detail.filePath)}</span>
        </div>
        <div class="detail-meta-item">
          <span class="detail-meta-label">Language:</span>
          <span class="detail-meta-value">${escapeHtml(detail.language)}</span>
        </div>
        <div class="detail-meta-item">
          <span class="detail-meta-label">Type:</span>
          <span class="detail-meta-value">${escapeHtml(detail.kind)}</span>
        </div>
        <div class="detail-meta-item">
          <span class="detail-meta-label">Lines:</span>
          <span class="detail-meta-value">${detail.startLine}-${detail.endLine}</span>
        </div>
        ${detail.summary ? `
        <div class="detail-meta-item detail-meta-item--full">
          <span class="detail-meta-label">Summary:</span>
          <span class="detail-meta-value">${escapeHtml(detail.summary)}</span>
        </div>
        ` : ''}
        ${detail.dependencies.length > 0 ? `
        <div class="detail-meta-item detail-meta-item--full">
          <span class="detail-meta-label">Dependencies:</span>
          <span class="detail-meta-value">${detail.dependencies.map(d => escapeHtml(d)).join(', ')}</span>
        </div>
        ` : ''}
      </div>
      <div class="code-preview" data-testid="code-preview">
        <pre><code>${escapeHtml(detail.content)}</code></pre>
      </div>
    `;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    body.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
  }
}

function closeDetailPanel(container: HTMLElement): void {
  const panel = container.querySelector('[data-testid="detail-panel"]') as HTMLElement | null;
  if (panel) {
    panel.style.display = 'none';
  }
  state.selectedChunkId = null;
  updateUrl();
}

/**
 * Cleanup any event listeners or timers.
 */
export function destroy(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  for (const fn of cleanupFns) {
    fn();
  }
  cleanupFns = [];
  state = createDefaultState();
}
