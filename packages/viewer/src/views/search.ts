let cleanup: (() => void) | null = null;

/**
 * Render the Search Playground view with a search input placeholder.
 */
export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="view-header">
      <h2>Search Playground</h2>
      <p class="view-subtitle">Test hybrid search queries against the index</p>
    </div>
    <div class="search-bar">
      <input type="text" id="search-input" class="search-input" placeholder="Enter a search query..." disabled />
      <select id="search-mode" class="filter-select" disabled>
        <option value="hybrid">Hybrid</option>
        <option value="semantic">Semantic</option>
        <option value="keyword">Keyword</option>
      </select>
      <button id="search-btn" class="btn btn-primary" disabled>Search</button>
    </div>
    <div class="search-results">
      <p class="placeholder-text">Search Playground coming soon.</p>
    </div>
  `;

  cleanup = null;
}

/**
 * Cleanup any event listeners or timers.
 */
export function destroy(): void {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
}
