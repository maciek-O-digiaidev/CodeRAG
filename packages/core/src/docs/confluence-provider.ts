import { ok, err, type Result } from 'neverthrow';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ConfluenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfluenceError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfluenceContentType = 'page' | 'blogpost' | 'comment';

export interface ConfluenceConfig {
  /** Confluence base URL, e.g., "https://mycompany.atlassian.net" */
  baseUrl: string;
  /** Email address for API token authentication */
  email: string;
  /** Confluence API token (Cloud) or personal access token (Data Center) */
  apiToken: string;
  /** OAuth bearer token (alternative to email + apiToken) */
  oauthToken?: string;
  /** Space keys to include (empty = all spaces) */
  spaceKeys?: string[];
  /** Maximum pages to fetch per request (pagination limit) */
  maxPages?: number;
}

export interface ConfluencePage {
  id: string;
  title: string;
  spaceKey: string;
  type: ConfluenceContentType;
  /** Plain text content (converted from Confluence storage format) */
  plainText: string;
  /** Original storage format HTML */
  storageFormat: string;
  url: string;
  version: number;
  lastModified: Date;
  parentId?: string;
  labels: string[];
  metadata: Record<string, unknown>;
}

/**
 * Confluence REST API v2 response for a single page/blogpost.
 */
interface ConfluenceApiContent {
  id: string;
  title: string;
  status: string;
  spaceId?: string;
  parentId?: string;
  version?: {
    number: number;
    createdAt: string;
  };
  body?: {
    storage?: {
      value: string;
    };
  };
  _links?: {
    webui?: string;
  };
  labels?: {
    results: Array<{ name: string }>;
  };
}

/**
 * Confluence REST API v2 paginated response.
 */
interface ConfluenceApiListResponse {
  results: ConfluenceApiContent[];
  _links?: {
    next?: string;
  };
}

/**
 * Confluence REST API v1 search result (for CQL queries).
 */
interface ConfluenceCqlResult {
  results: Array<{
    content: {
      id: string;
      type: string;
      title: string;
      status: string;
      _links?: {
        webui?: string;
      };
    };
    lastModified: string;
  }>;
  _links?: {
    next?: string;
  };
}

/**
 * Space info returned by Confluence API.
 */
interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
}

interface ConfluenceSpaceListResponse {
  results: ConfluenceSpace[];
  _links?: {
    next?: string;
  };
}

/**
 * Represents a page or blogpost with minimal info for change detection.
 */
export interface ConfluenceChangedItem {
  id: string;
  title: string;
  type: ConfluenceContentType;
  lastModified: Date;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface DocsProvider {
  readonly name: string;
  initialize(config: Record<string, unknown>): Promise<Result<void, ConfluenceError>>;
  fetchPages(spaceKeys?: string[]): Promise<Result<ConfluencePage[], ConfluenceError>>;
  fetchPage(pageId: string): Promise<Result<ConfluencePage, ConfluenceError>>;
  fetchBlogPosts(spaceKeys?: string[]): Promise<Result<ConfluencePage[], ConfluenceError>>;
  fetchComments(pageId: string): Promise<Result<ConfluencePage[], ConfluenceError>>;
  getChangedPages(since: Date): Promise<Result<ConfluenceChangedItem[], ConfluenceError>>;
}

// ---------------------------------------------------------------------------
// XHTML to plain text converter
// ---------------------------------------------------------------------------

/**
 * Converts Confluence storage format (XHTML) to plain text.
 *
 * Handles common Confluence macros and HTML elements:
 * - Strips all HTML tags
 * - Preserves text content
 * - Converts block elements to newlines
 * - Handles Confluence-specific macros (code blocks, panels, etc.)
 * - Decodes HTML entities
 */
export function confluenceStorageToPlainText(storageFormat: string): string {
  if (!storageFormat) {
    return '';
  }

  let text = storageFormat;

  // Remove Confluence macro bodies that aren't useful as text
  // e.g., <ac:structured-macro ac:name="toc">...</ac:structured-macro>
  text = text.replace(
    /<ac:structured-macro[^>]*ac:name="(toc|anchor|excerpt-include|include)"[^>]*>[\s\S]*?<\/ac:structured-macro>/gi,
    '',
  );

  // Extract plain-text-body content from macros (code blocks, panels, etc.)
  text = text.replace(
    /<ac:plain-text-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-body>/gi,
    '$1\n',
  );

  // Extract rich-text-body content from macros
  text = text.replace(
    /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/gi,
    '$1\n',
  );

  // Remove remaining Confluence-specific XML tags (ac:*, ri:*, at:*)
  text = text.replace(/<\/?(?:ac|ri|at):[^>]*>/gi, '');

  // Convert block-level HTML elements to newlines
  const blockElements = [
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'tr', 'br', 'hr', 'blockquote', 'pre',
    'table', 'thead', 'tbody', 'tfoot',
  ];
  const blockPattern = new RegExp(
    `<\\/?(${blockElements.join('|')})[^>]*>`,
    'gi',
  );
  text = text.replace(blockPattern, '\n');

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Normalize whitespace: collapse multiple blank lines, trim lines
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, i, arr) => {
      // Remove consecutive blank lines (keep at most one)
      if (line === '' && i > 0 && arr[i - 1] === '') {
        return false;
      }
      return true;
    })
    .join('\n')
    .trim();

  return text;
}

/**
 * Decodes common HTML entities to their character equivalents.
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '\u2013',
    '&mdash;': '\u2014',
    '&lsquo;': '\u2018',
    '&rsquo;': '\u2019',
    '&ldquo;': '\u201C',
    '&rdquo;': '\u201D',
    '&hellip;': '\u2026',
    '&copy;': '\u00A9',
    '&reg;': '\u00AE',
    '&trade;': '\u2122',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replaceAll(entity, char);
  }

  // Handle numeric character references (&#123; and &#x7B;)
  result = result.replace(/&#(\d+);/g, (_match, dec: string) =>
    String.fromCharCode(parseInt(dec, 10)),
  );
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  return result;
}

// ---------------------------------------------------------------------------
// ConfluenceProvider
// ---------------------------------------------------------------------------

/**
 * Confluence documentation provider.
 *
 * Fetches pages, blog posts, and comments from Confluence via the REST API.
 * Supports both Cloud (email + API token) and OAuth authentication.
 * Converts Confluence storage format (XHTML) to plain text for indexing.
 */
export class ConfluenceProvider implements DocsProvider {
  readonly name = 'confluence';

  private config: ConfluenceConfig | null = null;
  private baseUrl = '';
  private authHeader = '';
  private spaceKeyToId: Map<string, string> = new Map();

  /**
   * Validates the configuration and tests the connection.
   */
  async initialize(
    config: Record<string, unknown>,
  ): Promise<Result<void, ConfluenceError>> {
    const {
      baseUrl,
      email,
      apiToken,
      oauthToken,
      spaceKeys,
      maxPages,
    } = config as Record<string, unknown>;

    if (!baseUrl || typeof baseUrl !== 'string') {
      return err(
        new ConfluenceError('Confluence config missing required field: baseUrl'),
      );
    }

    // Require either (email + apiToken) or oauthToken
    const hasBasicAuth =
      typeof email === 'string' && email.length > 0 &&
      typeof apiToken === 'string' && apiToken.length > 0;
    const hasOAuth =
      typeof oauthToken === 'string' && oauthToken.length > 0;

    if (!hasBasicAuth && !hasOAuth) {
      return err(
        new ConfluenceError(
          'Confluence config requires either (email + apiToken) or oauthToken for authentication',
        ),
      );
    }

    // Normalize base URL: strip trailing slash
    const normalizedBaseUrl = (baseUrl as string).replace(/\/+$/, '');

    this.config = {
      baseUrl: normalizedBaseUrl,
      email: (email as string) ?? '',
      apiToken: (apiToken as string) ?? '',
      oauthToken: hasOAuth ? (oauthToken as string) : undefined,
      spaceKeys: Array.isArray(spaceKeys)
        ? (spaceKeys as string[]).filter((k) => typeof k === 'string')
        : undefined,
      maxPages: typeof maxPages === 'number' && maxPages > 0 ? maxPages : 25,
    };

    this.baseUrl = normalizedBaseUrl;

    if (hasOAuth) {
      this.authHeader = `Bearer ${oauthToken as string}`;
    } else {
      this.authHeader = `Basic ${btoa(`${email as string}:${apiToken as string}`)}`;
    }

    // Test connection by fetching spaces
    try {
      const response = await fetch(
        `${this.baseUrl}/wiki/api/v2/spaces?limit=1`,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        return err(
          new ConfluenceError(
            `Confluence connection failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new ConfluenceError(`Confluence connection failed: ${message}`),
      );
    }
  }

  /**
   * Fetches all pages from the specified spaces (or configured spaces).
   * Uses the Confluence REST API v2 pages endpoint with pagination.
   */
  async fetchPages(
    spaceKeys?: string[],
  ): Promise<Result<ConfluencePage[], ConfluenceError>> {
    this.ensureInitialized();

    const effectiveSpaceKeys = spaceKeys ?? this.config!.spaceKeys;

    try {
      if (effectiveSpaceKeys && effectiveSpaceKeys.length > 0) {
        // Fetch pages per space
        const allPages: ConfluencePage[] = [];
        for (const spaceKey of effectiveSpaceKeys) {
          const spaceIdResult = await this.resolveSpaceId(spaceKey);
          if (spaceIdResult.isErr()) {
            return err(spaceIdResult.error);
          }
          const spaceId = spaceIdResult.value;
          const pagesResult = await this.fetchPaginatedContent(
            `${this.baseUrl}/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}/pages?body-format=storage`,
            'page',
            spaceKey,
          );
          if (pagesResult.isErr()) {
            return err(pagesResult.error);
          }
          allPages.push(...pagesResult.value);
        }
        return ok(allPages);
      }

      // No space filter: fetch all pages
      const pagesResult = await this.fetchPaginatedContent(
        `${this.baseUrl}/wiki/api/v2/pages?body-format=storage`,
        'page',
      );
      return pagesResult;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new ConfluenceError(`Failed to fetch pages: ${message}`),
      );
    }
  }

  /**
   * Fetches a single page by its ID.
   */
  async fetchPage(
    pageId: string,
  ): Promise<Result<ConfluencePage, ConfluenceError>> {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${this.baseUrl}/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          return err(new ConfluenceError(`Page not found: ${pageId}`));
        }
        return err(
          new ConfluenceError(
            `Failed to fetch page ${pageId}: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const content = (await response.json()) as ConfluenceApiContent;
      const spaceKey = await this.resolveSpaceKeyFromId(content.spaceId ?? '');
      return ok(this.mapContent(content, 'page', spaceKey));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new ConfluenceError(`Failed to fetch page ${pageId}: ${message}`),
      );
    }
  }

  /**
   * Fetches all blog posts from the specified spaces (or configured spaces).
   */
  async fetchBlogPosts(
    spaceKeys?: string[],
  ): Promise<Result<ConfluencePage[], ConfluenceError>> {
    this.ensureInitialized();

    const effectiveSpaceKeys = spaceKeys ?? this.config!.spaceKeys;

    try {
      if (effectiveSpaceKeys && effectiveSpaceKeys.length > 0) {
        const allPosts: ConfluencePage[] = [];
        for (const spaceKey of effectiveSpaceKeys) {
          const spaceIdResult = await this.resolveSpaceId(spaceKey);
          if (spaceIdResult.isErr()) {
            return err(spaceIdResult.error);
          }
          const spaceId = spaceIdResult.value;
          const postsResult = await this.fetchPaginatedContent(
            `${this.baseUrl}/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}/blogposts?body-format=storage`,
            'blogpost',
            spaceKey,
          );
          if (postsResult.isErr()) {
            return err(postsResult.error);
          }
          allPosts.push(...postsResult.value);
        }
        return ok(allPosts);
      }

      const postsResult = await this.fetchPaginatedContent(
        `${this.baseUrl}/wiki/api/v2/blogposts?body-format=storage`,
        'blogpost',
      );
      return postsResult;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new ConfluenceError(`Failed to fetch blog posts: ${message}`),
      );
    }
  }

  /**
   * Fetches all comments for a specific page.
   */
  async fetchComments(
    pageId: string,
  ): Promise<Result<ConfluencePage[], ConfluenceError>> {
    this.ensureInitialized();

    try {
      const commentsResult = await this.fetchPaginatedContent(
        `${this.baseUrl}/wiki/api/v2/pages/${encodeURIComponent(pageId)}/footer-comments?body-format=storage`,
        'comment',
        undefined,
        pageId,
      );
      return commentsResult;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new ConfluenceError(
          `Failed to fetch comments for page ${pageId}: ${message}`,
        ),
      );
    }
  }

  /**
   * Returns items (pages and blog posts) that changed since the specified date.
   * Uses CQL (Confluence Query Language) to find recently modified content.
   */
  async getChangedPages(
    since: Date,
  ): Promise<Result<ConfluenceChangedItem[], ConfluenceError>> {
    this.ensureInitialized();

    try {
      const sinceStr = since.toISOString().replace(/\.\d{3}Z$/, '.000Z');
      // Use yyyy-MM-dd format for CQL
      const datePart = sinceStr.slice(0, 10);

      let cql = `lastModified >= "${datePart}" AND type IN ("page", "blogpost")`;

      const effectiveSpaceKeys = this.config!.spaceKeys;
      if (effectiveSpaceKeys && effectiveSpaceKeys.length > 0) {
        const spaceFilter = effectiveSpaceKeys
          .map((k) => `"${k}"`)
          .join(', ');
        cql += ` AND space IN (${spaceFilter})`;
      }

      const limit = this.config!.maxPages ?? 25;
      const params = new URLSearchParams({
        cql,
        limit: String(limit),
      });

      const response = await fetch(
        `${this.baseUrl}/wiki/rest/api/content/search?${params.toString()}`,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        return err(
          new ConfluenceError(
            `CQL search failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const data = (await response.json()) as ConfluenceCqlResult;

      const changedItems: ConfluenceChangedItem[] = data.results.map(
        (result) => ({
          id: result.content.id,
          title: result.content.title,
          type: result.content.type === 'blogpost' ? 'blogpost' as const : 'page' as const,
          lastModified: new Date(result.lastModified),
        }),
      );

      return ok(changedItems);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new ConfluenceError(`Failed to fetch changed pages: ${message}`),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.config) {
      throw new ConfluenceError(
        'ConfluenceProvider has not been initialized. Call initialize() first.',
      );
    }
  }

  /**
   * Resolves a space key to a space ID via the v2 API.
   */
  private async resolveSpaceId(
    spaceKey: string,
  ): Promise<Result<string, ConfluenceError>> {
    // Check cache first
    const cached = this.spaceKeyToId.get(spaceKey);
    if (cached) {
      return ok(cached);
    }

    try {
      const params = new URLSearchParams({ keys: spaceKey });
      const response = await fetch(
        `${this.baseUrl}/wiki/api/v2/spaces?${params.toString()}`,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        return err(
          new ConfluenceError(
            `Failed to resolve space "${spaceKey}": ${response.status} ${response.statusText}`,
          ),
        );
      }

      const data = (await response.json()) as ConfluenceSpaceListResponse;
      if (data.results.length === 0) {
        return err(
          new ConfluenceError(`Space not found: ${spaceKey}`),
        );
      }

      const spaceId = data.results[0]!.id;
      this.spaceKeyToId.set(spaceKey, spaceId);
      return ok(spaceId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new ConfluenceError(
          `Failed to resolve space "${spaceKey}": ${message}`,
        ),
      );
    }
  }

  /**
   * Resolves a space ID back to a space key (best effort).
   */
  private async resolveSpaceKeyFromId(spaceId: string): Promise<string> {
    if (!spaceId) {
      return 'UNKNOWN';
    }

    // Check reverse cache
    for (const [key, id] of this.spaceKeyToId.entries()) {
      if (id === spaceId) {
        return key;
      }
    }

    // Fetch space info
    try {
      const response = await fetch(
        `${this.baseUrl}/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}`,
        {
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/json',
          },
        },
      );

      if (response.ok) {
        const space = (await response.json()) as ConfluenceSpace;
        this.spaceKeyToId.set(space.key, space.id);
        return space.key;
      }
    } catch {
      // Best effort — return unknown if we can't resolve
    }

    return 'UNKNOWN';
  }

  /**
   * Fetches paginated content from a Confluence v2 API endpoint.
   */
  private async fetchPaginatedContent(
    initialUrl: string,
    type: ConfluenceContentType,
    spaceKey?: string,
    parentPageId?: string,
  ): Promise<Result<ConfluencePage[], ConfluenceError>> {
    const allItems: ConfluencePage[] = [];
    let url: string | undefined = initialUrl;
    const limit = this.config!.maxPages ?? 25;

    // Add limit parameter if not already present
    if (!url.includes('limit=')) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}limit=${limit}`;
    }

    while (url) {
      const response = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return err(
          new ConfluenceError(
            `Failed to fetch ${type}s: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const data = (await response.json()) as ConfluenceApiListResponse;

      for (const item of data.results) {
        const effectiveSpaceKey = spaceKey ?? 'UNKNOWN';
        const page = this.mapContent(item, type, effectiveSpaceKey, parentPageId);
        allItems.push(page);
      }

      // Follow pagination
      if (data._links?.next) {
        url = `${this.baseUrl}${data._links.next}`;
      } else {
        url = undefined;
      }
    }

    return ok(allItems);
  }

  /**
   * Maps a raw Confluence API content object to a ConfluencePage.
   */
  private mapContent(
    content: ConfluenceApiContent,
    type: ConfluenceContentType,
    spaceKey: string,
    parentPageId?: string,
  ): ConfluencePage {
    const storageFormat = content.body?.storage?.value ?? '';
    const plainText = confluenceStorageToPlainText(storageFormat);

    const labels = content.labels?.results?.map((l) => l.name) ?? [];
    const webuiLink = content._links?.webui ?? '';
    const pageUrl = webuiLink
      ? `${this.baseUrl}/wiki${webuiLink}`
      : `${this.baseUrl}/wiki/spaces/${encodeURIComponent(spaceKey)}/pages/${content.id}`;

    return {
      id: content.id,
      title: content.title,
      spaceKey,
      type,
      plainText,
      storageFormat,
      url: pageUrl,
      version: content.version?.number ?? 1,
      lastModified: content.version?.createdAt
        ? new Date(content.version.createdAt)
        : new Date(),
      parentId: parentPageId ?? content.parentId ?? undefined,
      labels,
      metadata: {
        status: content.status,
        spaceId: content.spaceId,
      },
    };
  }
}
