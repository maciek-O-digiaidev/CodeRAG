let cleanup: (() => void) | null = null;

/**
 * Render the Chunk Browser view with a table placeholder.
 */
export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="view-header">
      <h2>Chunk Browser</h2>
      <p class="view-subtitle">Browse and inspect indexed code chunks</p>
    </div>
    <div class="toolbar">
      <input type="text" class="filter-input" placeholder="Filter by file path..." disabled />
      <select class="filter-select" disabled>
        <option value="">All languages</option>
      </select>
      <select class="filter-select" disabled>
        <option value="">All kinds</option>
      </select>
    </div>
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>File</th>
            <th>Language</th>
            <th>Lines</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="5" class="placeholder-text">Chunk Browser coming soon.</td>
          </tr>
        </tbody>
      </table>
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
