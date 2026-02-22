import { parseHash, type ViewName } from './router.js';
import { initTheme, toggleTheme } from './theme.js';
import * as dashboard from './views/dashboard.js';
import * as chunks from './views/chunks.js';
import * as graph from './views/graph.js';
import * as embeddings from './views/embeddings.js';
import * as search from './views/search.js';

interface ViewModule {
  render(container: HTMLElement): void;
  destroy(): void;
}

const views: Record<ViewName, ViewModule> = {
  dashboard,
  chunks,
  graph,
  embeddings,
  search,
};

let currentView: ViewName | null = null;

/**
 * Update the active nav link in the sidebar.
 */
function updateActiveNav(viewName: ViewName): void {
  const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
  navLinks.forEach((link) => {
    const linkView = link.getAttribute('data-view');
    if (linkView === viewName) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

/**
 * Render the appropriate view based on the current hash.
 */
function handleRoute(): void {
  const route = parseHash(window.location.hash);
  const content = document.getElementById('content');
  if (!content) return;

  // Destroy the current view if switching
  if (currentView && currentView !== route.view) {
    views[currentView].destroy();
  }

  // Render the new view
  views[route.view].render(content);
  currentView = route.view;
  updateActiveNav(route.view);
}

/**
 * Initialize the application.
 */
function init(): void {
  // Initialize theme
  initTheme();

  // Set up theme toggle button
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Set up hash-based routing
  window.addEventListener('hashchange', handleRoute);

  // Handle initial route (default to dashboard if no hash)
  if (!window.location.hash) {
    window.location.hash = '#/dashboard';
  } else {
    handleRoute();
  }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
