export type ViewName = 'dashboard' | 'chunks' | 'graph' | 'embeddings' | 'search';

export interface Route {
  view: ViewName;
  params: Record<string, string>;
}

const VALID_VIEWS: ReadonlySet<string> = new Set<ViewName>([
  'dashboard',
  'chunks',
  'graph',
  'embeddings',
  'search',
]);

/**
 * Parse a URL hash into a Route object.
 * Supports formats: #/view, #/view?key=value&key2=value2
 * Falls back to 'dashboard' for invalid or empty hashes.
 */
export function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, '');
  const [viewPart, queryPart] = cleaned.split('?');
  const viewCandidate = (viewPart ?? '').toLowerCase();

  const view: ViewName = VALID_VIEWS.has(viewCandidate)
    ? (viewCandidate as ViewName)
    : 'dashboard';

  const params: Record<string, string> = {};
  if (queryPart) {
    const searchParams = new URLSearchParams(queryPart);
    searchParams.forEach((value, key) => {
      params[key] = value;
    });
  }

  return { view, params };
}

/**
 * Navigate to a view by updating the URL hash.
 */
export function navigate(view: ViewName, params?: Record<string, string>): void {
  let hash = `#/${view}`;
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams(params);
    hash += `?${searchParams.toString()}`;
  }
  window.location.hash = hash;
}
