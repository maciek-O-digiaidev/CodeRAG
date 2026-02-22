let cleanup: (() => void) | null = null;

/**
 * Render the Embedding Explorer view with a plot placeholder.
 */
export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="view-header">
      <h2>Embedding Explorer</h2>
      <p class="view-subtitle">Explore embedding space with 2D projections</p>
    </div>
    <div class="embedding-controls">
      <label class="control-label">
        Max points:
        <input type="number" class="limit-input" value="500" min="10" max="5000" disabled />
      </label>
      <button class="btn btn-primary" disabled>Load Embeddings</button>
    </div>
    <div class="plot-container">
      <div id="embedding-plot" class="plot-area">
        <p class="placeholder-text">Embedding Explorer coming soon.</p>
      </div>
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
