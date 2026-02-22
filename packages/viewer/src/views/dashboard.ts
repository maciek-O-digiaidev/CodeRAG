let cleanup: (() => void) | null = null;

/**
 * Render the Dashboard view with stats card placeholders.
 */
export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="view-header">
      <h2>Dashboard</h2>
      <p class="view-subtitle">Index overview and health metrics</p>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Total Chunks</span>
        <span class="stat-value" id="stat-chunks">--</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Total Files</span>
        <span class="stat-value" id="stat-files">--</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Embeddings</span>
        <span class="stat-value" id="stat-embeddings">--</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Last Indexed</span>
        <span class="stat-value" id="stat-last-indexed">--</span>
      </div>
    </div>
    <div class="placeholder-section">
      <p class="placeholder-text">Dashboard details coming soon.</p>
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
