import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SharePointProvider,
  SharePointError,
  extractTextFromDocx,
  extractTextFromPdf,
} from './sharepoint-provider.js';

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
    arrayBuffer: () => Promise.resolve(body as ArrayBuffer),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => createMockResponse(body, status, statusText),
    body: null,
    bodyUsed: false,
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

function createTokenResponse(expiresIn = 3600) {
  return {
    access_token: 'mock-access-token-abc123',
    token_type: 'Bearer',
    expires_in: expiresIn,
  };
}

function createSitePage(overrides?: Record<string, unknown>) {
  return {
    id: 'page-001',
    title: 'Engineering Handbook',
    webUrl: 'https://contoso.sharepoint.com/sites/eng/SitePages/handbook.aspx',
    lastModifiedDateTime: '2026-02-20T10:00:00Z',
    contentType: { name: 'Site Page' },
    ...(overrides ?? {}),
  };
}

function createDriveItem(overrides?: Record<string, unknown>) {
  return {
    id: 'item-001',
    name: 'Architecture.docx',
    file: {
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    size: 45000,
    webUrl:
      'https://contoso.sharepoint.com/sites/eng/Shared%20Documents/Architecture.docx',
    lastModifiedDateTime: '2026-02-18T14:30:00Z',
    parentReference: {
      driveId: 'drive-001',
      name: 'Documents',
    },
    ...(overrides ?? {}),
  };
}

function createDrive(overrides?: Record<string, unknown>) {
  return {
    id: 'drive-001',
    name: 'Documents',
    webUrl: 'https://contoso.sharepoint.com/sites/eng/Shared%20Documents',
    ...(overrides ?? {}),
  };
}

const VALID_CONFIG = {
  tenantId: 'tenant-abc-123',
  clientId: 'client-def-456',
  clientSecret: 'secret-ghi-789',
  siteIds: ['site-001', 'site-002'],
  libraryNames: ['Documents'],
  maxPages: 25,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SharePointProvider', () => {
  let provider: SharePointProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new SharePointProvider();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- name ---

  it('should have name set to sharepoint', () => {
    expect(provider.name).toBe('sharepoint');
  });

  // --- initialize ---

  describe('initialize', () => {
    it('should return ok on successful token acquisition', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );

      const result = await provider.initialize(VALID_CONFIG);

      expect(result.isOk()).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toContain('login.microsoftonline.com');
      expect(url).toContain(VALID_CONFIG.tenantId);
      expect(url).toContain('/oauth2/v2.0/token');
    });

    it('should send correct OAuth2 client credentials request', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );

      await provider.initialize(VALID_CONFIG);

      const callOptions = fetchSpy.mock.calls[0]![1] as RequestInit;
      expect(callOptions.method).toBe('POST');
      const contentType = (callOptions.headers as Record<string, string>)[
        'Content-Type'
      ];
      expect(contentType).toBe('application/x-www-form-urlencoded');

      const body = callOptions.body as string;
      expect(body).toContain('client_id=client-def-456');
      expect(body).toContain('client_secret=secret-ghi-789');
      expect(body).toContain('grant_type=client_credentials');
      expect(body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
    });

    it('should return err when tenantId is missing', async () => {
      const result = await provider.initialize({
        clientId: 'abc',
        clientSecret: 'def',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(SharePointError);
        expect(result.error.message).toContain('tenantId');
      }
    });

    it('should return err when clientId is missing', async () => {
      const result = await provider.initialize({
        tenantId: 'abc',
        clientSecret: 'def',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(SharePointError);
        expect(result.error.message).toContain('clientId');
      }
    });

    it('should return err when clientSecret is missing', async () => {
      const result = await provider.initialize({
        tenantId: 'abc',
        clientId: 'def',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(SharePointError);
        expect(result.error.message).toContain('clientSecret');
      }
    });

    it('should return err when token acquisition fails with HTTP error', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(
          { error: 'invalid_client' },
          401,
          'Unauthorized',
        ),
      );

      const result = await provider.initialize(VALID_CONFIG);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(SharePointError);
        expect(result.error.message).toContain('401');
      }
    });

    it('should return err when token acquisition throws a network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await provider.initialize(VALID_CONFIG);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });

    it('should use default maxPages when not specified', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );

      const result = await provider.initialize({
        tenantId: 'abc',
        clientId: 'def',
        clientSecret: 'ghi',
      });

      expect(result.isOk()).toBe(true);
    });

    it('should filter out non-string siteIds', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );

      const result = await provider.initialize({
        ...VALID_CONFIG,
        siteIds: ['valid-site', 123, null, 'another-site'],
      });

      expect(result.isOk()).toBe(true);
    });
  });

  // --- fetchPages ---

  describe('fetchPages', () => {
    async function initializeProvider(): Promise<void> {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );
      await provider.initialize(VALID_CONFIG);
    }

    it('should fetch pages from specified sites', async () => {
      await initializeProvider();

      // Pages response
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [createSitePage()],
        }),
      );
      // Page content (web parts)
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [{ innerHtml: '<p>Welcome to the Engineering Handbook.</p>' }],
        }),
      );

      const result = await provider.fetchPages(['site-001']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const page = result.value[0]!;
        expect(page.id).toBe('page-001');
        expect(page.title).toBe('Engineering Handbook');
        expect(page.type).toBe('page');
        expect(page.siteId).toBe('site-001');
        expect(page.plainText).toContain('Welcome to the Engineering Handbook');
      }
    });

    it('should handle pagination with @odata.nextLink', async () => {
      await initializeProvider();

      // First page of results
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [createSitePage({ id: 'page-1', title: 'Page 1' })],
          '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/sites/site-001/pages?$skiptoken=abc',
        }),
      );

      // Second page of results
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [createSitePage({ id: 'page-2', title: 'Page 2' })],
        }),
      );

      // Content fetch for page-1
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );
      // Content fetch for page-2
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.fetchPages(['site-001']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]!.id).toBe('page-1');
        expect(result.value[1]!.id).toBe('page-2');
      }
    });

    it('should return err when no site IDs are provided and none configured', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );
      await provider.initialize({
        tenantId: 'abc',
        clientId: 'def',
        clientSecret: 'ghi',
      });

      const result = await provider.fetchPages();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('No site IDs');
      }
    });

    it('should use configured siteIds when none passed explicitly', async () => {
      await initializeProvider();

      // Pages for site-001
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createSitePage()] }),
      );
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      // Pages for site-002
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [createSitePage({ id: 'page-002', title: 'Site 2 Page' })],
        }),
      );
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.fetchPages();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('should return err on Graph API failure', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse(
          { error: { message: 'Forbidden' } },
          403,
          'Forbidden',
        ),
      );

      const result = await provider.fetchPages(['site-001']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('403');
      }
    });

    it('should return empty array when no pages exist', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.fetchPages(['site-001']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should handle page content fetch failure gracefully', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createSitePage()] }),
      );
      // Content fetch fails
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 500, 'Internal Server Error'),
      );

      const result = await provider.fetchPages(['site-001']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.plainText).toBe('');
      }
    });

    it('should combine web part HTML content', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createSitePage()] }),
      );
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            { innerHtml: '<p>Part 1</p>' },
            { data: { innerHTML: '<p>Part 2</p>' } },
          ],
        }),
      );

      const result = await provider.fetchPages(['site-001']);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.plainText).toContain('Part 1');
        expect(result.value[0]!.plainText).toContain('Part 2');
      }
    });

    it('should return err on network error', async () => {
      await initializeProvider();

      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.fetchPages(['site-001']);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Network error');
      }
    });
  });

  // --- fetchDocuments ---

  describe('fetchDocuments', () => {
    async function initializeProvider(): Promise<void> {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );
      await provider.initialize(VALID_CONFIG);
    }

    it('should fetch documents from a site library', async () => {
      await initializeProvider();

      // Drives response
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      // Drive items response
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDriveItem()] }),
      );

      // File download (docx content)
      const emptyZip = new ArrayBuffer(0);
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(emptyZip),
      );

      const result = await provider.fetchDocuments('site-001');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        const doc = result.value[0]!;
        expect(doc.id).toBe('item-001');
        expect(doc.name).toBe('Architecture.docx');
        expect(doc.type).toBe('document');
        expect(doc.siteId).toBe('site-001');
        expect(doc.libraryName).toBe('Documents');
        expect(doc.mimeType).toContain('wordprocessingml');
      }
    });

    it('should filter by library name', async () => {
      await initializeProvider();

      // Drives: multiple libraries
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            createDrive({ id: 'drive-001', name: 'Documents' }),
            createDrive({ id: 'drive-002', name: 'Archives' }),
          ],
        }),
      );

      // Only "Documents" drive should be queried
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.fetchDocuments('site-001', 'Documents');

      expect(result.isOk()).toBe(true);
      // Should only fetch items from the matching drive
      // The second fetchSpy call is for drive items of "Documents" only
      expect(fetchSpy).toHaveBeenCalledTimes(3); // token + drives + drive items
    });

    it('should skip unsupported file types', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            createDriveItem({
              id: 'img-001',
              name: 'screenshot.png',
              file: { mimeType: 'image/png' },
            }),
            createDriveItem({
              id: 'doc-001',
              name: 'report.docx',
              file: {
                mimeType:
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              },
            }),
          ],
        }),
      );

      // Only docx will trigger download
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(new ArrayBuffer(0)),
      );

      const result = await provider.fetchDocuments('site-001');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.name).toBe('report.docx');
      }
    });

    it('should skip items without file property (folders)', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            {
              id: 'folder-001',
              name: 'Reports',
              size: 0,
              webUrl: 'https://contoso.sharepoint.com/sites/eng/Documents/Reports',
              lastModifiedDateTime: '2026-02-10T10:00:00Z',
              // No file property — this is a folder
            },
          ],
        }),
      );

      const result = await provider.fetchDocuments('site-001');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should handle PDF documents', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            createDriveItem({
              id: 'pdf-001',
              name: 'whitepaper.pdf',
              file: { mimeType: 'application/pdf' },
            }),
          ],
        }),
      );

      // PDF download
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(new ArrayBuffer(0)),
      );

      const result = await provider.fetchDocuments('site-001');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.mimeType).toBe('application/pdf');
      }
    });

    it('should return err on Graph API failure for drives', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 404, 'Not Found'),
      );

      const result = await provider.fetchDocuments('nonexistent-site');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('404');
      }
    });

    it('should handle file download failure gracefully', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDriveItem()] }),
      );

      // Download fails
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 500, 'Internal Server Error'),
      );

      const result = await provider.fetchDocuments('site-001');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.plainText).toBe('');
      }
    });

    it('should return err on network failure', async () => {
      await initializeProvider();

      fetchSpy.mockRejectedValueOnce(new Error('Timeout'));

      const result = await provider.fetchDocuments('site-001');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Timeout');
      }
    });

    it('should handle pagination for drive items', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      // First page
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [createDriveItem({ id: 'doc-1', name: 'doc1.docx' })],
          '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/sites/site-001/drives/drive-001/root/children?$skiptoken=xyz',
        }),
      );

      // Download doc-1
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(new ArrayBuffer(0)),
      );

      // Second page
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [createDriveItem({ id: 'doc-2', name: 'doc2.docx' })],
        }),
      );

      // Download doc-2
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(new ArrayBuffer(0)),
      );

      const result = await provider.fetchDocuments('site-001');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]!.id).toBe('doc-1');
        expect(result.value[1]!.id).toBe('doc-2');
      }
    });

    it('should use configured libraryNames when no explicit filter is given', async () => {
      await initializeProvider();

      // Returns two drives, only "Documents" matches config
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            createDrive({ id: 'drive-001', name: 'Documents' }),
            createDrive({ id: 'drive-002', name: 'Archives' }),
          ],
        }),
      );

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.fetchDocuments('site-001');

      expect(result.isOk()).toBe(true);
      // Only "Documents" drive should be queried
      expect(fetchSpy).toHaveBeenCalledTimes(3); // token + drives + items
    });
  });

  // --- getChangedItems ---

  describe('getChangedItems', () => {
    async function initializeProvider(): Promise<void> {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );
      await provider.initialize(VALID_CONFIG);
    }

    it('should fetch changed items since a date', async () => {
      await initializeProvider();

      // Drives for site-001
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      // Delta response
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            {
              id: 'item-new',
              name: 'new-doc.docx',
              file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
              lastModifiedDateTime: '2026-02-20T12:00:00Z',
            },
            {
              id: 'item-old',
              name: 'old-doc.docx',
              file: { mimeType: 'application/pdf' },
              lastModifiedDateTime: '2026-01-01T00:00:00Z',
            },
          ],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/drives/drive-001/root/delta?token=xyz',
        }),
      );

      // Drives for site-002
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive({ id: 'drive-002', name: 'Documents' })] }),
      );

      // Delta response for site-002
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const since = new Date('2026-02-15T00:00:00Z');
      const result = await provider.getChangedItems(since);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Only the item modified after "since" should be included
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe('item-new');
        expect(result.value[0]!.type).toBe('document');
        expect(result.value[0]!.changeType).toBe('updated');
      }
    });

    it('should detect deleted items', async () => {
      await initializeProvider();

      // Drives for site-001
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            {
              id: 'item-deleted',
              name: 'removed.docx',
              deleted: { state: 'deleted' },
              lastModifiedDateTime: '2026-02-20T08:00:00Z',
            },
          ],
        }),
      );

      // Drives for site-002
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive({ id: 'drive-002', name: 'Documents' })] }),
      );
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.getChangedItems(new Date('2026-02-01'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.changeType).toBe('deleted');
      }
    });

    it('should return err when no site IDs configured', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse()),
      );
      await provider.initialize({
        tenantId: 'abc',
        clientId: 'def',
        clientSecret: 'ghi',
      });

      const result = await provider.getChangedItems(new Date());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('No site IDs');
      }
    });

    it('should return err on Graph API failure', async () => {
      await initializeProvider();

      fetchSpy.mockResolvedValueOnce(
        createMockResponse({}, 500, 'Internal Server Error'),
      );

      const result = await provider.getChangedItems(new Date());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('500');
      }
    });

    it('should return empty array when no items changed', async () => {
      await initializeProvider();

      // Drives for site-001
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      // Drives for site-002
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive({ id: 'drive-002', name: 'Documents' })] }),
      );
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.getChangedItems(new Date());

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should handle delta pagination', async () => {
      await initializeProvider();

      // Drives for site-001
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive()] }),
      );

      // First delta page
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            {
              id: 'change-1',
              name: 'doc1.docx',
              file: { mimeType: 'application/pdf' },
              lastModifiedDateTime: '2026-02-20T10:00:00Z',
            },
          ],
          '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/drives/drive-001/root/delta?$skiptoken=abc',
        }),
      );

      // Second delta page
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({
          value: [
            {
              id: 'change-2',
              name: 'doc2.pdf',
              file: { mimeType: 'application/pdf' },
              lastModifiedDateTime: '2026-02-21T10:00:00Z',
            },
          ],
        }),
      );

      // Drives for site-002
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [createDrive({ id: 'drive-002', name: 'Documents' })] }),
      );
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.getChangedItems(new Date('2026-02-01'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('should return err on network error', async () => {
      await initializeProvider();

      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await provider.getChangedItems(new Date());

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Connection refused');
      }
    });
  });

  // --- Error when not initialized ---

  describe('when not initialized', () => {
    it('should throw SharePointError from fetchPages', async () => {
      await expect(provider.fetchPages()).rejects.toThrow(SharePointError);
    });

    it('should throw SharePointError from fetchDocuments', async () => {
      await expect(provider.fetchDocuments('site-001')).rejects.toThrow(
        SharePointError,
      );
    });

    it('should throw SharePointError from getChangedItems', async () => {
      await expect(
        provider.getChangedItems(new Date()),
      ).rejects.toThrow(SharePointError);
    });
  });

  // --- Token refresh ---

  describe('token refresh', () => {
    it('should re-acquire token when expired', async () => {
      // Initial token with very short expiry (already expired)
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse(30)), // 30 sec, minus 60s buffer = already expired
      );

      await provider.initialize(VALID_CONFIG);

      // Token refresh
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(createTokenResponse(3600)),
      );

      // Pages response
      fetchSpy.mockResolvedValueOnce(
        createMockResponse({ value: [] }),
      );

      const result = await provider.fetchPages(['site-001']);

      expect(result.isOk()).toBe(true);
      // Should have made 3 calls: initial token + refresh token + pages
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

describe('extractTextFromDocx', () => {
  it('should return empty string for empty buffer', () => {
    expect(extractTextFromDocx(new ArrayBuffer(0))).toBe('');
  });

  it('should return empty string for non-ZIP data', () => {
    const buffer = new TextEncoder().encode('not a zip file').buffer;
    expect(extractTextFromDocx(buffer as ArrayBuffer)).toBe('');
  });

  it('should extract text from a minimal docx-like ZIP structure', () => {
    // Build a minimal ZIP containing word/document.xml with <w:t> elements
    const xml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello World</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>';
    const buffer = buildMinimalZip('word/document.xml', xml);

    const result = extractTextFromDocx(buffer);

    expect(result).toContain('Hello World');
    expect(result).toContain('Second paragraph');
  });

  it('should handle multiple w:t elements in a single paragraph', () => {
    const xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Part 1 </w:t></w:r><w:r><w:t>Part 2</w:t></w:r></w:p></w:body></w:document>';
    const buffer = buildMinimalZip('word/document.xml', xml);

    const result = extractTextFromDocx(buffer);

    expect(result).toContain('Part 1');
    expect(result).toContain('Part 2');
  });

  it('should handle w:t with xml:space preserve attribute', () => {
    const xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve"> spaced text </w:t></w:r></w:p></w:body></w:document>';
    const buffer = buildMinimalZip('word/document.xml', xml);

    const result = extractTextFromDocx(buffer);

    expect(result).toContain('spaced text');
  });
});

describe('extractTextFromPdf', () => {
  it('should return empty string for empty buffer', () => {
    expect(extractTextFromPdf(new ArrayBuffer(0))).toBe('');
  });

  it('should extract text from Tj operators', () => {
    const pdfContent = '%PDF-1.4\nBT\n/F1 12 Tf\n(Hello PDF World) Tj\nET\n';
    const buffer = new TextEncoder().encode(pdfContent).buffer;

    const result = extractTextFromPdf(buffer as ArrayBuffer);

    expect(result).toContain('Hello PDF World');
  });

  it('should extract text from TJ array operators', () => {
    const pdfContent =
      '%PDF-1.4\nBT\n/F1 12 Tf\n[(First) -10 (Second) -20 (Third)] TJ\nET\n';
    const buffer = new TextEncoder().encode(pdfContent).buffer;

    const result = extractTextFromPdf(buffer as ArrayBuffer);

    expect(result).toContain('First');
    expect(result).toContain('Second');
    expect(result).toContain('Third');
  });

  it('should handle escaped characters in PDF strings', () => {
    const pdfContent =
      '%PDF-1.4\nBT\n(Hello \\(world\\)) Tj\nET\n';
    const buffer = new TextEncoder().encode(pdfContent).buffer;

    const result = extractTextFromPdf(buffer as ArrayBuffer);

    expect(result).toContain('Hello (world)');
  });

  it('should handle newline escapes in PDF strings', () => {
    const pdfContent =
      '%PDF-1.4\nBT\n(Line1\\nLine2) Tj\nET\n';
    const buffer = new TextEncoder().encode(pdfContent).buffer;

    const result = extractTextFromPdf(buffer as ArrayBuffer);

    expect(result).toContain('Line1');
    expect(result).toContain('Line2');
  });

  it('should handle multiple BT/ET blocks', () => {
    const pdfContent =
      '%PDF-1.4\nBT\n(Block 1) Tj\nET\nBT\n(Block 2) Tj\nET\n';
    const buffer = new TextEncoder().encode(pdfContent).buffer;

    const result = extractTextFromPdf(buffer as ArrayBuffer);

    expect(result).toContain('Block 1');
    expect(result).toContain('Block 2');
  });

  it('should return empty string for PDF without text content', () => {
    const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';
    const buffer = new TextEncoder().encode(pdfContent).buffer;

    const result = extractTextFromPdf(buffer as ArrayBuffer);

    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ZIP builder helper (for docx tests)
// ---------------------------------------------------------------------------

/**
 * Builds a minimal ZIP file containing a single uncompressed entry.
 * This is a simplified ZIP structure for testing extractTextFromDocx.
 */
function buildMinimalZip(filename: string, content: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const filenameBytes = encoder.encode(filename);
  const contentBytes = encoder.encode(content);

  const filenameLen = filenameBytes.length;
  const contentLen = contentBytes.length;

  // Local file header (30 + filenameLen bytes)
  const localHeaderSize = 30 + filenameLen;
  // Central directory header (46 + filenameLen bytes)
  const centralHeaderSize = 46 + filenameLen;
  // End of central directory (22 bytes)
  const eocdSize = 22;

  const totalSize =
    localHeaderSize + contentLen + centralHeaderSize + eocdSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;

  // --- Local File Header ---
  view.setUint32(offset, 0x04034b50, true); // signature
  offset += 4;
  view.setUint16(offset, 20, true); // version needed
  offset += 2;
  view.setUint16(offset, 0, true); // flags
  offset += 2;
  view.setUint16(offset, 0, true); // compression method (store)
  offset += 2;
  view.setUint16(offset, 0, true); // mod time
  offset += 2;
  view.setUint16(offset, 0, true); // mod date
  offset += 2;
  view.setUint32(offset, 0, true); // CRC32 (simplified)
  offset += 4;
  view.setUint32(offset, contentLen, true); // compressed size
  offset += 4;
  view.setUint32(offset, contentLen, true); // uncompressed size
  offset += 4;
  view.setUint16(offset, filenameLen, true); // filename length
  offset += 2;
  view.setUint16(offset, 0, true); // extra field length
  offset += 2;

  bytes.set(filenameBytes, offset);
  offset += filenameLen;

  bytes.set(contentBytes, offset);
  offset += contentLen;

  // --- Central Directory Header ---
  const centralStart = offset;
  view.setUint32(offset, 0x02014b50, true); // signature
  offset += 4;
  view.setUint16(offset, 20, true); // version made by
  offset += 2;
  view.setUint16(offset, 20, true); // version needed
  offset += 2;
  view.setUint16(offset, 0, true); // flags
  offset += 2;
  view.setUint16(offset, 0, true); // compression method
  offset += 2;
  view.setUint16(offset, 0, true); // mod time
  offset += 2;
  view.setUint16(offset, 0, true); // mod date
  offset += 2;
  view.setUint32(offset, 0, true); // CRC32
  offset += 4;
  view.setUint32(offset, contentLen, true); // compressed size
  offset += 4;
  view.setUint32(offset, contentLen, true); // uncompressed size
  offset += 4;
  view.setUint16(offset, filenameLen, true); // filename length
  offset += 2;
  view.setUint16(offset, 0, true); // extra field length
  offset += 2;
  view.setUint16(offset, 0, true); // file comment length
  offset += 2;
  view.setUint16(offset, 0, true); // disk number start
  offset += 2;
  view.setUint16(offset, 0, true); // internal attrs
  offset += 2;
  view.setUint32(offset, 0, true); // external attrs
  offset += 4;
  view.setUint32(offset, 0, true); // local header offset
  offset += 4;

  bytes.set(filenameBytes, offset);
  offset += filenameLen;

  // --- End of Central Directory ---
  view.setUint32(offset, 0x06054b50, true); // signature
  offset += 4;
  view.setUint16(offset, 0, true); // disk number
  offset += 2;
  view.setUint16(offset, 0, true); // central dir disk
  offset += 2;
  view.setUint16(offset, 1, true); // entries on disk
  offset += 2;
  view.setUint16(offset, 1, true); // total entries
  offset += 2;
  view.setUint32(offset, centralHeaderSize, true); // central dir size
  offset += 4;
  view.setUint32(offset, centralStart, true); // central dir offset
  offset += 4;
  view.setUint16(offset, 0, true); // comment length
  offset += 2;

  return buffer;
}
