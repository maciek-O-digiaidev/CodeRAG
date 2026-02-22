const THEME_KEY = 'coderag-theme';

export type Theme = 'dark' | 'light';

/**
 * Read the saved theme from localStorage, defaulting to 'dark'.
 */
export function getSavedTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  return 'dark';
}

/**
 * Apply a theme to the document body.
 */
function applyTheme(theme: Theme): void {
  document.body.setAttribute('data-theme', theme);
  const icon = document.querySelector('.theme-icon');
  if (icon) {
    icon.textContent = theme === 'dark' ? '\u{1F319}' : '\u{2600}\u{FE0F}';
  }
}

/**
 * Initialize theme from localStorage and apply it.
 */
export function initTheme(): void {
  const theme = getSavedTheme();
  applyTheme(theme);
}

/**
 * Toggle between dark and light themes, persisting the choice.
 */
export function toggleTheme(): void {
  const current = getSavedTheme();
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}
