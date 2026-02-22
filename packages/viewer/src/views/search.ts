import { createApiClient, type SearchResponse } from '../api.js';
import { parseHash, navigate } from '../router.js';

interface SearchState {
  query: string;
  vectorWeight: number;
  bm25Weight: number;
  topK: number;
}

const DEFAULT_VECTOR_WEIGHT = 0.5;
const DEFAULT_BM25_WEIGHT = 0.5;
const DEFAULT_TOP_K = 10;
const TOP_K_OPTIONS: ReadonlyArray<number> = [5, 10, 20, 50];
const DEBOUNCE_MS = 300;

let state: SearchState = createDefaultState();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupFns: Array<() => void> = [];

function createDefaultState(): SearchState {
  return {
    query: '',
    vectorWeight: DEFAULT_VECTOR_WEIGHT,
    bm25Weight: DEFAULT_BM25_WEIGHT,
    topK: DEFAULT_TOP_K,
  };
}

function parseStateFromHash(): SearchState {
  const route = parseHash(window.location.hash);
  const vectorWeight = parseFloat(route.params['vectorWeight'] ?? '');
  const bm25Weight = parseFloat(route.params['bm25Weight'] ?? '');
  const topK = parseInt(route.params['topK'] ?? '', 10);

  return {
    query: route.params['q'] ?? '',
    vectorWeight: !isNaN(vectorWeight) && vectorWeight >= 0 && vectorWeight <= 1
      ? Math.round(vectorWeight * 10) / 10
      : DEFAULT_VECTOR_WEIGHT,
    bm25Weight: !isNaN(bm25Weight) && bm25Weight >= 0 && bm25Weight <= 1
      ? Math.round(bm25Weight * 10) / 10
      : DEFAULT_BM25_WEIGHT,
    topK: TOP_K_OPTIONS.includes(topK) ? topK : DEFAULT_TOP_K,
  };
}

function stateToParams(s: SearchState): Record<string, string> {
  const params: Record<string, string> = {};
  if (s.query) params['q'] = s.query;
  if (s.vectorWeight !== DEFAULT_VECTOR_WEIGHT) params['vectorWeight'] = s.vectorWeight.toFixed(1);
  if (s.bm25Weight !== DEFAULT_BM25_WEIGHT) params['bm25Weight'] = s.bm25Weight.toFixed(1);
  if (s.topK !== DEFAULT_TOP_K) params['topK'] = String(s.topK);
  return params;
}

function updateUrl(): void {
  navigate('search', stateToParams(state));
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
 * Render the Search Playground view with query input, sliders, and results.
 */
export function render(container: HTMLElement): void {
  state = parseStateFromHash();

  container.innerHTML = `
    <div class="view-header">
      <h2>Search Playground</h2>
      <p class="view-subtitle">Test hybrid search queries against the index</p>
    </div>
    <div class="search-bar" data-testid="search-bar">
      <input type="text" class="search-input" data-testid="search-input"
        placeholder="Enter a search query..." value="${escapeHtml(state.query)}" />
      <button class="btn btn-primary" data-testid="search-submit">Search</button>
      <button class="btn" data-testid="search-clear">Clear</button>
    </div>
    <div class="search-controls" data-testid="search-controls">
      <div class="weight-sliders" data-testid="weight-sliders">
        <div class="slider-group">
          <label class="slider-label">
            Vector weight: <span class="slider-value" data-testid="vector-weight-value">${state.vectorWeight.toFixed(1)}</span>
          </label>
          <input type="range" class="weight-slider" data-testid="vector-weight-slider"
            min="0" max="1" step="0.1" value="${state.vectorWeight.toFixed(1)}" />
        </div>
        <div class="slider-group">
          <label class="slider-label">
            BM25 weight: <span class="slider-value" data-testid="bm25-weight-value">${state.bm25Weight.toFixed(1)}</span>
          </label>
          <input type="range" class="weight-slider" data-testid="bm25-weight-slider"
            min="0" max="1" step="0.1" value="${state.bm25Weight.toFixed(1)}" />
        </div>
      </div>
      <div class="topk-control">
        <label class="control-label">
          Top K:
          <select class="filter-select" data-testid="topk-select">
            ${TOP_K_OPTIONS.map(k => `<option value="${k}" ${k === state.topK ? 'selected' : ''}>${k}</option>`).join('')}
          </select>
        </label>
      </div>
    </div>
    <div class="timing-badges" data-testid="timing-badges" style="display: none;"></div>
    <div class="search-results" data-testid="search-results">
      <p class="placeholder-text" data-testid="search-empty">Enter a query and click Search to begin.</p>
    </div>
  `;

  bindEvents(container);

  // If query exists from URL, auto-search
  if (state.query) {
    void executeSearch(container);
  }
}

function bindEvents(container: HTMLElement): void {
  const searchInput = container.querySelector('[data-testid="search-input"]') as HTMLInputElement | null;
  const submitBtn = container.querySelector('[data-testid="search-submit"]');
  const clearBtn = container.querySelector('[data-testid="search-clear"]');
  const vectorSlider = container.querySelector('[data-testid="vector-weight-slider"]') as HTMLInputElement | null;
  const bm25Slider = container.querySelector('[data-testid="bm25-weight-slider"]') as HTMLInputElement | null;
  const topkSelect = container.querySelector('[data-testid="topk-select"]') as HTMLSelectElement | null;

  const onSubmit = (): void => {
    if (searchInput) {
      state.query = searchInput.value.trim();
    }
    updateUrl();
    void executeSearch(container);
  };

  const onClear = (): void => {
    state = createDefaultState();
    if (searchInput) searchInput.value = '';
    if (vectorSlider) vectorSlider.value = String(DEFAULT_VECTOR_WEIGHT);
    if (bm25Slider) bm25Slider.value = String(DEFAULT_BM25_WEIGHT);
    if (topkSelect) topkSelect.value = String(DEFAULT_TOP_K);
    updateWeightDisplays(container);
    updateUrl();
    clearResults(container);
  };

  const onKeyDown = (e: Event): void => {
    if ((e as KeyboardEvent).key === 'Enter') {
      onSubmit();
    }
  };

  const onVectorSliderInput = (): void => {
    if (vectorSlider) {
      state.vectorWeight = Math.round(parseFloat(vectorSlider.value) * 10) / 10;
      state.bm25Weight = Math.round((1 - state.vectorWeight) * 10) / 10;
      if (bm25Slider) bm25Slider.value = state.bm25Weight.toFixed(1);
      updateWeightDisplays(container);
      debouncedSearch(container);
    }
  };

  const onBm25SliderInput = (): void => {
    if (bm25Slider) {
      state.bm25Weight = Math.round(parseFloat(bm25Slider.value) * 10) / 10;
      state.vectorWeight = Math.round((1 - state.bm25Weight) * 10) / 10;
      if (vectorSlider) vectorSlider.value = state.vectorWeight.toFixed(1);
      updateWeightDisplays(container);
      debouncedSearch(container);
    }
  };

  const onTopkChange = (): void => {
    if (topkSelect) {
      state.topK = parseInt(topkSelect.value, 10);
      updateUrl();
      if (state.query) {
        void executeSearch(container);
      }
    }
  };

  submitBtn?.addEventListener('click', onSubmit);
  clearBtn?.addEventListener('click', onClear);
  searchInput?.addEventListener('keydown', onKeyDown);
  vectorSlider?.addEventListener('input', onVectorSliderInput);
  bm25Slider?.addEventListener('input', onBm25SliderInput);
  topkSelect?.addEventListener('change', onTopkChange);

  cleanupFns.push(() => {
    submitBtn?.removeEventListener('click', onSubmit);
    clearBtn?.removeEventListener('click', onClear);
    searchInput?.removeEventListener('keydown', onKeyDown);
    vectorSlider?.removeEventListener('input', onVectorSliderInput);
    bm25Slider?.removeEventListener('input', onBm25SliderInput);
    topkSelect?.removeEventListener('change', onTopkChange);
  });
}

function updateWeightDisplays(container: HTMLElement): void {
  const vectorValue = container.querySelector('[data-testid="vector-weight-value"]');
  const bm25Value = container.querySelector('[data-testid="bm25-weight-value"]');
  if (vectorValue) vectorValue.textContent = state.vectorWeight.toFixed(1);
  if (bm25Value) bm25Value.textContent = state.bm25Weight.toFixed(1);
}

function debouncedSearch(container: HTMLElement): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updateUrl();
    if (state.query) {
      void executeSearch(container);
    }
  }, DEBOUNCE_MS);
}

function clearResults(container: HTMLElement): void {
  const resultsEl = container.querySelector('[data-testid="search-results"]');
  const timingEl = container.querySelector('[data-testid="timing-badges"]') as HTMLElement | null;
  if (resultsEl) {
    resultsEl.innerHTML = '<p class="placeholder-text" data-testid="search-empty">Enter a query and click Search to begin.</p>';
  }
  if (timingEl) {
    timingEl.style.display = 'none';
    timingEl.innerHTML = '';
  }
}

async function executeSearch(container: HTMLElement): Promise<void> {
  const resultsEl = container.querySelector('[data-testid="search-results"]');
  const timingEl = container.querySelector('[data-testid="timing-badges"]') as HTMLElement | null;
  if (!resultsEl) return;

  if (!state.query) {
    clearResults(container);
    return;
  }

  resultsEl.innerHTML = '<div class="spinner"></div><p class="loading-text">Searching...</p>';
  if (timingEl) {
    timingEl.style.display = 'none';
  }

  try {
    const api = createApiClient();
    const startTime = performance.now();
    const response: SearchResponse = await api.search({
      query: state.query,
      limit: state.topK,
      mode: 'hybrid',
    });
    const totalMs = Math.round(performance.now() - startTime);

    renderTimingBadges(container, response.timingMs, totalMs);
    renderSearchResults(container, response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    resultsEl.innerHTML = `<p class="error-message" data-testid="search-error">${escapeHtml(message)}</p>`;
  }
}

function renderTimingBadges(container: HTMLElement, serverMs: number, totalMs: number): void {
  const timingEl = container.querySelector('[data-testid="timing-badges"]') as HTMLElement | null;
  if (!timingEl) return;

  // We show total timing from the response and our client-side total
  timingEl.style.display = 'flex';
  timingEl.innerHTML = `
    <span class="timing-badge" data-testid="timing-server">Server: ${serverMs}ms</span>
    <span class="timing-badge" data-testid="timing-total">Total: ${totalMs}ms</span>
  `;
}

function renderSearchResults(container: HTMLElement, response: SearchResponse): void {
  const resultsEl = container.querySelector('[data-testid="search-results"]');
  if (!resultsEl) return;

  if (response.results.length === 0) {
    resultsEl.innerHTML = '<p class="placeholder-text" data-testid="search-no-results">No results found for this query.</p>';
    return;
  }

  const maxScore = response.results.reduce((max, r) => Math.max(max, r.score), 0);

  resultsEl.innerHTML = response.results.map((result, index) => {
    const vectorPortion = state.vectorWeight;
    const bm25Portion = state.bm25Weight;
    const normalizedScore = maxScore > 0 ? result.score / maxScore : 0;
    const vectorWidth = vectorPortion * normalizedScore * 100;
    const bm25Width = bm25Portion * normalizedScore * 100;

    return `
      <div class="search-result" data-testid="search-result">
        <div class="result-header">
          <span class="result-rank" data-testid="result-rank">${index + 1}</span>
          <div class="result-info">
            <span class="result-name" data-testid="result-name">${escapeHtml(result.name)}</span>
            <span class="result-file">${escapeHtml(result.filePath)}</span>
            <span class="result-kind">${escapeHtml(result.kind)}</span>
          </div>
          <span class="result-score" data-testid="result-score">${result.score.toFixed(4)}</span>
        </div>
        <div class="score-bar" data-testid="score-bar">
          <div class="score-bar-vector" style="width: ${vectorWidth.toFixed(1)}%;" data-testid="score-bar-vector"></div>
          <div class="score-bar-bm25" style="width: ${bm25Width.toFixed(1)}%;" data-testid="score-bar-bm25"></div>
        </div>
        <div class="score-bar-legend">
          <span class="score-legend-vector">Vector: ${(state.vectorWeight * result.score).toFixed(4)}</span>
          <span class="score-legend-bm25">BM25: ${(state.bm25Weight * result.score).toFixed(4)}</span>
        </div>
        ${result.snippet ? `<p class="result-snippet" data-testid="result-snippet">${escapeHtml(result.snippet)}</p>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Cleanup any event listeners or timers.
 */
export function destroy(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const fn of cleanupFns) {
    fn();
  }
  cleanupFns = [];
  state = createDefaultState();
}
