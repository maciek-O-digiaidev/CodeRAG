import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConfluenceProvider,
  ConfluenceError,
  confluenceStorageToPlainText,
} from './confluence-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockResponse(
  body: unknown,
  status = 200,
  statusText = 'OK',
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => createMockResponse(body, status, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

function createConfluencePage(overrides?: Record<string, unknown>) {
  return {
    id: '12345',
    title: 'Getting Started Guide',
    status: 'current',
    spaceId: 'space-id-1',
    parentId: 'parent-1',
    version: {
      number: 3,
      createdAt: '2026-02-01T10:00:00.000Z',
    },
    body: {
      storage: {
        value: '<p>Welcome to the <strong>Getting Started</strong> guide.</p><p>Follow these steps to begin.</p>',
      },
    },
    _links: {
      webui: '/spaces/DEV/pages/12345/Getting+Started+Guide',
    },
    labels: {
      results: [{ name: 'onboarding' }, { name: 'docs' }],
    },
    ...(overrides ?? {}),
  };
}

function createBlogPost(overrides?: Record<string, unknown>) {
  return {
    id: '67890',
    title: 'Sprint 5 Retrospective',
    status: 'current',
    spaceId: 'space-id-1',
    version: {
      number: 1,
      createdAt: '2026-02-15T14:30:00.000Z',
    },
    body: {
      storage: {
        value: '<p>Summary of Sprint 5 outcomes.</p>',
      },
    },
    _links: {
      webui: '/spaces/DEV/blog/67890',
    },
    labels: {
      results: [{ name: 'retro' }],
    },
    ...(overrides ?? {}),
  };
}

function createComment(overrides?: Record<string, unknown>) {
  return {
    id: '99999',
    title: 'Re: Getting Started Guide',
    status: 'current',
    spaceId: 'space-id-1',
    version: {
      number: 1,
      createdAt: '2026-02-02T08:00:00.000Z',
    },
    body: {
      storage: {
        value: '<p>Great guide, thanks!</p>',
      },
    },
    _links: {},
    labels: { results: [] },
    ...(overrides ?? {}),
  };
}

const VALID_CONFIG = {
  baseUrl: 'https://mycompany.atlassian.net',
  email: 'user@example.com',
  apiToken: 'test-api-token-123',
  spaceKeys: ['DEV', 'TEAM'],
  maxPages: 25,
};

const OAUTH_CONFIG = {
  baseUrl: 'https://mycompany.atlassian.net',
  oauthToken: 'oauth-bearer-token-456',
  spaceKeys: ['DEV'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfluenceProvider', () => {
  let provider: ConfluenceProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new ConfluenceProvider();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- name ---

  it('should have name set to confluence', () => {
    expect(provider.name).toBe('confluence');
  });

  // --- initialize ---

  describe('initialize', () => {
    it('should return ok on successful connection with API token', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [{ id: '1', key: 'DEV', name: 'Dev' }] }),
      );

      const result = await provider.initialize(VALID_CONFIG);
      expect(result.isOk()).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0]![0]).toContain('/wiki/api/v2/spaces');
    });

    it('should return ok on successful connection with OAuth token', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );

      const result = await provider.initialize(OAUTH_CONFIG);
      expect(result.isOk()).toBe(true);
    });

    it('should return err when baseUrl is missing', async () => {
      const result = await provider.initialize({
        email: 'user@example.com',
        apiToken: 'token',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ConfluenceError);
        expect(result.error.message).toContain('baseUrl');
      }
    });

    it('should return err when neither API token nor OAuth token is provided', async () => {
      const result = await provider.initialize({
        baseUrl: 'https://mycompany.atlassian.net',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ConfluenceError);
        expect(result.error.message).toContain('authentication');
      }
    });

    it('should return err when email is provided but apiToken is missing', async () => {
      const result = await provider.initialize({
        baseUrl: 'https://mycompany.atlassian.net',
        email: 'user@example.com',
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('authentication');
      }
    });

    it('should return err when connection fails with HTTP error', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ message: 'Unauthorized' }, 401, 'Unauthorized'),
      );

      const result = await provider.initialize(VALID_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('401');
      }
    });

    it('should return err when connection throws a network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await provider.initialize(VALID_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });

    it('should send correct Basic auth header for API token auth', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );

      await provider.initialize(VALID_CONFIG);

      const callHeaders = fetchSpy.mock.calls[0]![1]?.headers as Record<
        string,
        string
      >;
      const expectedAuth = `Basic ${btoa(`${VALID_CONFIG.email}:${VALID_CONFIG.apiToken}`)}`;
      expect(callHeaders['Authorization']).toBe(expectedAuth);
    });

    it('should send correct Bearer auth header for OAuth', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );

      await provider.initialize(OAUTH_CONFIG);

      const callHeaders = fetchSpy.mock.calls[0]![1]?.headers as Record<
        string,
        string
      >;
      expect(callHeaders['Authorization']).toBe(`Bearer ${OAUTH_CONFIG.oauthToken}`);
    });

    it('should strip trailing slashes from baseUrl', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );

      await provider.initialize({
        ...VALID_CONFIG,
        baseUrl: 'https://mycompany.atlassian.net///',
      });

      expect(fetchSpy.mock.calls[0]![0]).toContain(
        'https://mycompany.atlassian.net/wiki/api/v2/spaces',
      );
      expect(fetchSpy.mock.calls[0]![0]).not.toContain('///');
    });
  });

  // --- fetchPages ---

  describe('fetchPages', () => {
    async function initializeProvider(): Promise<void> {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );
      await provider.initialize(VALID_CONFIG);
    }

    it('should fetch all pages without space filter', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage()],
          _links: {},
        }),
      );

      const result = await provider.fetchPages([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const page = result.value[0]!;
        expect(page.id).toBe('12345');
        expect(page.title).toBe('Getting Started Guide');
        expect(page.type).toBe('page');
        expect(page.labels).toEqual(['onboarding', 'docs']);
      }
    });

    it('should fetch pages filtered by space key', async () => {
      await initializeProvider();

      // resolveSpaceId call
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [{ id: 'space-id-dev', key: 'DEV', name: 'Development' }],
        }),
      );

      // Fetch pages in space
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage()],
          _links: {},
        }),
      );

      const result = await provider.fetchPages(['DEV']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.spaceKey).toBe('DEV');
      }
    });

    it('should use configured space keys when no explicit filter is given', async () => {
      await initializeProvider();

      // resolveSpaceId for DEV
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [{ id: 'space-id-dev', key: 'DEV', name: 'Development' }],
        }),
      );
      // Pages in DEV
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage()],
          _links: {},
        }),
      );
      // resolveSpaceId for TEAM
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [{ id: 'space-id-team', key: 'TEAM', name: 'Team' }],
        }),
      );
      // Pages in TEAM
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage({ id: '11111', title: 'Team Page' })],
          _links: {},
        }),
      );

      const result = await provider.fetchPages();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('should handle pagination', async () => {
      await initializeProvider();

      // First page of results
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage({ id: '1', title: 'Page 1' })],
          _links: { next: '/wiki/api/v2/pages?cursor=abc&body-format=storage' },
        }),
      );

      // Second page of results
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage({ id: '2', title: 'Page 2' })],
          _links: {},
        }),
      );

      const result = await provider.fetchPages([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]!.id).toBe('1');
        expect(result.value[1]!.id).toBe('2');
      }
    });

    it('should convert storage format to plain text', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage()],
          _links: {},
        }),
      );

      const result = await provider.fetchPages([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const page = result.value[0]!;
        expect(page.plainText).toContain('Welcome to the');
        expect(page.plainText).toContain('Getting Started');
        expect(page.plainText).not.toContain('<p>');
        expect(page.plainText).not.toContain('<strong>');
      }
    });

    it('should return err when space is not found', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );

      const result = await provider.fetchPages(['NONEXISTENT']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Space not found');
      }
    });

    it('should return err on API failure', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ message: 'Server Error' }, 500, 'Internal Server Error'),
      );

      const result = await provider.fetchPages([]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('500');
      }
    });

    it('should return err on network failure', async () => {
      await initializeProvider();

      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.fetchPages([]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Network error');
      }
    });

    it('should return empty array when no pages exist', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [], _links: {} }),
      );

      const result = await provider.fetchPages([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should construct correct page URL from webui link', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage()],
          _links: {},
        }),
      );

      const result = await provider.fetchPages([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.url).toBe(
          'https://mycompany.atlassian.net/wiki/spaces/DEV/pages/12345/Getting+Started+Guide',
        );
      }
    });

    it('should handle page without labels', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage({ labels: undefined })],
          _links: {},
        }),
      );

      const result = await provider.fetchPages([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.labels).toEqual([]);
      }
    });

    it('should handle page without body', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createConfluencePage({ body: undefined })],
          _links: {},
        }),
      );

      const result = await provider.fetchPages([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.plainText).toBe('');
        expect(result.value[0]!.storageFormat).toBe('');
      }
    });
  });

  // --- fetchPage ---

  describe('fetchPage', () => {
    async function initializeProvider(): Promise<void> {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );
      await provider.initialize(VALID_CONFIG);
    }

    it('should fetch and map a single page', async () => {
      await initializeProvider();

      // Space lookup for spaceId
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createConfluencePage()),
      );
      // resolveSpaceKeyFromId
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ id: 'space-id-1', key: 'DEV', name: 'Dev' }),
      );

      const result = await provider.fetchPage('12345');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('12345');
        expect(result.value.title).toBe('Getting Started Guide');
        expect(result.value.type).toBe('page');
        expect(result.value.version).toBe(3);
      }
    });

    it('should return err when page is not found (404)', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ message: 'Not Found' }, 404, 'Not Found'),
      );

      const result = await provider.fetchPage('nonexistent');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ConfluenceError);
        expect(result.error.message).toContain('not found');
        expect(result.error.message).toContain('nonexistent');
      }
    });

    it('should return err on non-404 HTTP error', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ message: 'Forbidden' }, 403, 'Forbidden'),
      );

      const result = await provider.fetchPage('12345');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('403');
      }
    });

    it('should return err on network error', async () => {
      await initializeProvider();

      fetchSpy.mockRejectedValueOnce(new Error('Connection reset'));

      const result = await provider.fetchPage('12345');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Connection reset');
      }
    });
  });

  // --- fetchBlogPosts ---

  describe('fetchBlogPosts', () => {
    async function initializeProvider(): Promise<void> {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );
      await provider.initialize(VALID_CONFIG);
    }

    it('should fetch all blog posts without space filter', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createBlogPost()],
          _links: {},
        }),
      );

      const result = await provider.fetchBlogPosts([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const post = result.value[0]!;
        expect(post.id).toBe('67890');
        expect(post.title).toBe('Sprint 5 Retrospective');
        expect(post.type).toBe('blogpost');
        expect(post.labels).toEqual(['retro']);
      }
    });

    it('should fetch blog posts filtered by space key', async () => {
      await initializeProvider();

      // resolveSpaceId
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [{ id: 'space-id-dev', key: 'DEV', name: 'Development' }],
        }),
      );

      // Blog posts in space
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createBlogPost()],
          _links: {},
        }),
      );

      const result = await provider.fetchBlogPosts(['DEV']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.spaceKey).toBe('DEV');
      }
    });

    it('should return err on API failure', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 500, 'Internal Server Error'),
      );

      const result = await provider.fetchBlogPosts([]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('500');
      }
    });

    it('should return empty array when no blog posts exist', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [], _links: {} }),
      );

      const result = await provider.fetchBlogPosts([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  // --- fetchComments ---

  describe('fetchComments', () => {
    async function initializeProvider(): Promise<void> {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );
      await provider.initialize(VALID_CONFIG);
    }

    it('should fetch comments for a page', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [createComment()],
          _links: {},
        }),
      );

      const result = await provider.fetchComments('12345');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const comment = result.value[0]!;
        expect(comment.id).toBe('99999');
        expect(comment.type).toBe('comment');
        expect(comment.plainText).toContain('Great guide');
        expect(comment.parentId).toBe('12345');
      }
    });

    it('should use correct API endpoint for comments', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [], _links: {} }),
      );

      await provider.fetchComments('12345');

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('/pages/12345/footer-comments');
      expect(url).toContain('body-format=storage');
    });

    it('should return err on API failure', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 500, 'Internal Server Error'),
      );

      const result = await provider.fetchComments('12345');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('500');
      }
    });

    it('should return empty array when no comments exist', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [], _links: {} }),
      );

      const result = await provider.fetchComments('12345');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  // --- getChangedPages ---

  describe('getChangedPages', () => {
    async function initializeProvider(): Promise<void> {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [] }),
      );
      await provider.initialize(VALID_CONFIG);
    }

    it('should fetch changed pages since a date', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          results: [
            {
              content: {
                id: '12345',
                type: 'page',
                title: 'Updated Guide',
                status: 'current',
              },
              lastModified: '2026-02-20T10:00:00.000Z',
            },
            {
              content: {
                id: '67890',
                type: 'blogpost',
                title: 'New Blog Post',
                status: 'current',
              },
              lastModified: '2026-02-21T14:00:00.000Z',
            },
          ],
          _links: {},
        }),
      );

      const since = new Date('2026-02-15T00:00:00.000Z');
      const result = await provider.getChangedPages(since);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]!.id).toBe('12345');
        expect(result.value[0]!.type).toBe('page');
        expect(result.value[1]!.type).toBe('blogpost');
      }
    });

    it('should build CQL with correct date format', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [], _links: {} }),
      );

      const since = new Date('2026-01-15T08:30:00.000Z');
      await provider.getChangedPages(since);

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('2026-01-15');
      expect(url).toContain('lastModified');
    });

    it('should include space filter in CQL when spaceKeys configured', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [], _links: {} }),
      );

      const since = new Date('2026-02-01T00:00:00.000Z');
      await provider.getChangedPages(since);

      const url = fetchSpy.mock.calls[1]![0] as string;
      expect(url).toContain('space');
      expect(url).toContain('DEV');
      expect(url).toContain('TEAM');
    });

    it('should return err on API failure', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 500, 'Internal Server Error'),
      );

      const result = await provider.getChangedPages(new Date());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('500');
      }
    });

    it('should return err on network error', async () => {
      await initializeProvider();

      fetchSpy.mockRejectedValueOnce(new Error('Timeout'));

      const result = await provider.getChangedPages(new Date());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Timeout');
      }
    });

    it('should return empty array when no pages changed', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ results: [], _links: {} }),
      );

      const result = await provider.getChangedPages(new Date());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  // --- Error when not initialized ---

  describe('when not initialized', () => {
    it('should throw ConfluenceError from fetchPages', async () => {
      await expect(provider.fetchPages()).rejects.toThrow(ConfluenceError);
    });

    it('should throw ConfluenceError from fetchPage', async () => {
      await expect(provider.fetchPage('123')).rejects.toThrow(ConfluenceError);
    });

    it('should throw ConfluenceError from fetchBlogPosts', async () => {
      await expect(provider.fetchBlogPosts()).rejects.toThrow(ConfluenceError);
    });

    it('should throw ConfluenceError from fetchComments', async () => {
      await expect(provider.fetchComments('123')).rejects.toThrow(
        ConfluenceError,
      );
    });

    it('should throw ConfluenceError from getChangedPages', async () => {
      await expect(
        provider.getChangedPages(new Date()),
      ).rejects.toThrow(ConfluenceError);
    });
  });
});

// ---------------------------------------------------------------------------
// XHTML to plain text converter
// ---------------------------------------------------------------------------

describe('confluenceStorageToPlainText', () => {
  it('should convert simple paragraph HTML to plain text', () => {
    const html = '<p>Hello world</p>';
    expect(confluenceStorageToPlainText(html)).toBe('Hello world');
  });

  it('should strip inline formatting tags', () => {
    const html = '<p>This is <strong>bold</strong> and <em>italic</em> text.</p>';
    expect(confluenceStorageToPlainText(html)).toBe(
      'This is bold and italic text.',
    );
  });

  it('should convert block elements to newlines', () => {
    const html = '<h1>Title</h1><p>Paragraph 1</p><p>Paragraph 2</p>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('Title');
    expect(result).toContain('Paragraph 1');
    expect(result).toContain('Paragraph 2');
    // Should have newlines between blocks
    expect(result.split('\n').length).toBeGreaterThanOrEqual(3);
  });

  it('should handle Confluence code block macros', () => {
    const html = `
      <ac:structured-macro ac:name="code">
        <ac:parameter ac:name="language">typescript</ac:parameter>
        <ac:plain-text-body><![CDATA[const x = 42;]]></ac:plain-text-body>
      </ac:structured-macro>
    `;
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('const x = 42;');
  });

  it('should handle rich-text-body macros', () => {
    const html = `
      <ac:structured-macro ac:name="info">
        <ac:rich-text-body><p>Important information here.</p></ac:rich-text-body>
      </ac:structured-macro>
    `;
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('Important information here.');
  });

  it('should remove toc macros', () => {
    const html = '<ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro><p>Content</p>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toBe('Content');
  });

  it('should remove anchor macros', () => {
    const html = '<ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">section1</ac:parameter></ac:structured-macro><p>Content</p>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toBe('Content');
  });

  it('should decode HTML entities', () => {
    const html = '<p>A &amp; B &lt; C &gt; D &quot;E&quot; F&#39;s</p>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toBe('A & B < C > D "E" F\'s');
  });

  it('should decode numeric character references', () => {
    const html = '<p>&#169; 2026 &#x2014; All rights reserved</p>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('\u00A9');
    expect(result).toContain('\u2014');
  });

  it('should handle list items', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
    expect(result).toContain('Item 3');
  });

  it('should handle table content', () => {
    const html = '<table><tr><td>Cell 1</td><td>Cell 2</td></tr><tr><td>Cell 3</td><td>Cell 4</td></tr></table>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('Cell 1');
    expect(result).toContain('Cell 2');
    expect(result).toContain('Cell 3');
    expect(result).toContain('Cell 4');
  });

  it('should collapse multiple blank lines', () => {
    const html = '<p>Line 1</p><br/><br/><br/><p>Line 2</p>';
    const result = confluenceStorageToPlainText(html);
    // Should not have more than one consecutive blank line
    expect(result).not.toMatch(/\n\n\n/);
  });

  it('should return empty string for empty input', () => {
    expect(confluenceStorageToPlainText('')).toBe('');
  });

  it('should return empty string for null-ish input', () => {
    expect(confluenceStorageToPlainText(undefined as unknown as string)).toBe('');
  });

  it('should handle Confluence ac: tags without body', () => {
    const html = '<p>Before <ac:emoticon ac:name="smile" /> After</p>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('Before');
    expect(result).toContain('After');
    expect(result).not.toContain('ac:');
  });

  it('should preserve text from nested elements', () => {
    const html = '<div><p>Outer <span>Inner <strong>Bold</strong> text</span> end</p></div>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('Outer');
    expect(result).toContain('Inner');
    expect(result).toContain('Bold');
    expect(result).toContain('text');
    expect(result).toContain('end');
  });

  it('should handle &nbsp; entities', () => {
    const html = '<p>Word1&nbsp;&nbsp;&nbsp;Word2</p>';
    const result = confluenceStorageToPlainText(html);
    expect(result).toContain('Word1');
    expect(result).toContain('Word2');
  });
});
