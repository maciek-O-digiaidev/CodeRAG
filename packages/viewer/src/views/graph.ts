let cleanup: (() => void) | null = null;

/**
 * Render the Dependency Graph view with a canvas placeholder.
 */
export function render(container: HTMLElement): void {
  container.innerHTML = `
    <div class="view-header">
      <h2>Dependency Graph</h2>
      <p class="view-subtitle">Visualize code dependencies and relationships</p>
    </div>
    <div class="graph-controls">
      <input type="text" class="filter-input" placeholder="Search node..." disabled />
      <label class="control-label">
        Depth:
        <input type="number" class="depth-input" value="2" min="1" max="5" disabled />
      </label>
    </div>
    <div class="canvas-container">
      <canvas id="graph-canvas" width="800" height="600"></canvas>
      <p class="placeholder-text overlay-text">Dependency Graph coming soon.</p>
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
