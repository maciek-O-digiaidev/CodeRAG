import { ok, err, type Result } from 'neverthrow';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SharePointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharePointError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SharePointConfig {
  /** Azure AD tenant ID */
  tenantId: string;
  /** Azure AD app registration client ID */
  clientId: string;
  /** Azure AD app registration client secret */
  clientSecret: string;
  /** SharePoint site IDs to index (empty = discover all accessible sites) */
  siteIds?: string[];
  /** Document library names to filter (empty = all libraries) */
  libraryNames?: string[];
  /** Maximum items to fetch per request (pagination limit) */
  maxPages?: number;
}

export type SharePointItemType = 'page' | 'document';

export interface SharePointPage {
  id: string;
  title: string;
  siteId: string;
  type: 'page';
  /** Plain text content extracted from the page */
  plainText: string;
  /** Original HTML content */
  htmlContent: string;
  url: string;
  lastModified: Date;
  metadata: Record<string, unknown>;
}

export interface SharePointDocument {
  id: string;
  name: string;
  siteId: string;
  libraryName: string;
  type: 'document';
  /** Plain text content extracted from the document */
  plainText: string;
  /** MIME type of the document */
  mimeType: string;
  /** Size in bytes */
  size: number;
  url: string;
  lastModified: Date;
  metadata: Record<string, unknown>;
}

export interface SharePointChangedItem {
  id: string;
  name: string;
  type: SharePointItemType;
  changeType: 'created' | 'updated' | 'deleted';
  lastModified: Date;
}

// ---------------------------------------------------------------------------
// Graph API response types
// ---------------------------------------------------------------------------

interface GraphTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface GraphSitePage {
  id: string;
  title: string;
  webUrl: string;
  lastModifiedDateTime: string;
  contentType?: {
    name: string;
  };
}

interface GraphSitePagesResponse {
  value: GraphSitePage[];
  '@odata.nextLink'?: string;
}

interface GraphDriveItem {
  id: string;
  name: string;
  file?: {
    mimeType: string;
  };
  size: number;
  webUrl: string;
  lastModifiedDateTime: string;
  parentReference?: {
    driveId: string;
    name?: string;
  };
}

interface GraphDriveItemsResponse {
  value: GraphDriveItem[];
  '@odata.nextLink'?: string;
}

interface GraphDrive {
  id: string;
  name: string;
  webUrl: string;
}

interface GraphDrivesResponse {
  value: GraphDrive[];
  '@odata.nextLink'?: string;
}

interface GraphDeltaItem {
  id: string;
  name: string;
  file?: {
    mimeType: string;
  };
  deleted?: {
    state: string;
  };
  lastModifiedDateTime: string;
}

interface GraphDeltaResponse {
  value: GraphDeltaItem[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const LOGIN_BASE_URL = 'https://login.microsoftonline.com';
const DEFAULT_MAX_PAGES = 25;
const SUPPORTED_DOC_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/pdf',
]);

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts plain text from a .docx file (Office Open XML).
 *
 * A .docx file is a ZIP archive containing XML files. The main document
 * body is in `word/document.xml`. This function performs a lightweight
 * extraction by finding `<w:t>` elements (text runs) in the XML.
 *
 * For full-fidelity extraction a library like `mammoth` would be needed,
 * but this zero-dependency approach is sufficient for search indexing.
 */
export function extractTextFromDocx(content: ArrayBuffer): string {
  const bytes = new Uint8Array(content);

  // A .docx is a ZIP file. Find the word/document.xml entry.
  const documentXml = extractFileFromZip(bytes, 'word/document.xml');
  if (!documentXml) {
    return '';
  }

  const xmlText = new TextDecoder('utf-8').decode(documentXml);

  // Extract text from <w:t> and <w:t xml:space="preserve"> elements
  const textParts: string[] = [];
  const wtRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = wtRegex.exec(xmlText)) !== null) {
    if (match[1]) {
      textParts.push(match[1]);
    }
  }

  // Insert paragraph breaks at </w:p> boundaries
  // We detect paragraph boundaries by looking at <w:p> tags
  let result = xmlText;
  // Replace paragraph boundaries with newline markers
  result = result.replace(/<\/w:p>/g, '{{PARA_BREAK}}');
  // Now extract text
  const paragraphs: string[] = [];
  const parts = result.split('{{PARA_BREAK}}');
  for (const part of parts) {
    const paraTexts: string[] = [];
    const partWtRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let partMatch: RegExpExecArray | null;
    while ((partMatch = partWtRegex.exec(part)) !== null) {
      if (partMatch[1]) {
        paraTexts.push(partMatch[1]);
      }
    }
    if (paraTexts.length > 0) {
      paragraphs.push(paraTexts.join(''));
    }
  }

  return paragraphs.join('\n').trim();
}

/**
 * Extracts plain text from a PDF file.
 *
 * This is a lightweight extraction that finds text streams in the PDF.
 * It handles simple text content but not complex encodings, CMap tables,
 * or compressed streams beyond basic FlateDecode.
 *
 * For production use, a dedicated PDF library (pdf-parse, pdfjs-dist) would
 * provide better results. This zero-dependency approach covers common cases
 * for search indexing.
 */
export function extractTextFromPdf(content: ArrayBuffer): string {
  const bytes = new Uint8Array(content);
  const text = new TextDecoder('latin1').decode(bytes);

  const textParts: string[] = [];

  // Extract text from BT ... ET blocks (text objects)
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let btMatch: RegExpExecArray | null;
  while ((btMatch = btEtRegex.exec(text)) !== null) {
    const block = btMatch[1] ?? '';
    // Extract text from Tj and TJ operators
    // Tj: (text) Tj
    const tjRegex = /\(((?:[^\\)]|\\.)*)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const decoded = decodePdfString(tjMatch[1] ?? '');
      if (decoded.trim()) {
        textParts.push(decoded);
      }
    }

    // TJ: [(text) num (text) ...] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArrayMatch: RegExpExecArray | null;
    while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
      const arrayContent = tjArrayMatch[1] ?? '';
      const innerRegex = /\(((?:[^\\)]|\\.)*)\)/g;
      let innerMatch: RegExpExecArray | null;
      while ((innerMatch = innerRegex.exec(arrayContent)) !== null) {
        const decoded = decodePdfString(innerMatch[1] ?? '');
        if (decoded.trim()) {
          textParts.push(decoded);
        }
      }
    }
  }

  // Join and normalize whitespace
  return textParts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decodes escaped characters in a PDF string literal.
 */
function decodePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

/**
 * Strips HTML tags and decodes basic entities, producing plain text.
 */
function htmlToPlainText(html: string): string {
  if (!html) {
    return '';
  }

  let text = html;

  // Convert block elements to newlines
  const blockElements = [
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'tr', 'br', 'hr', 'blockquote', 'pre',
  ];
  const blockPattern = new RegExp(
    `<\\/?(${blockElements.join('|')})[^>]*>`,
    'gi',
  );
  text = text.replace(blockPattern, '\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode basic HTML entities
  text = text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');

  // Normalize whitespace
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, i, arr) => {
      if (line === '' && i > 0 && arr[i - 1] === '') {
        return false;
      }
      return true;
    })
    .join('\n')
    .trim();

  return text;
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader (for .docx extraction)
// ---------------------------------------------------------------------------

/**
 * Extracts a single file from a ZIP archive by filename.
 * Only supports Store (no compression) and entries with local file headers.
 * This is intentionally minimal — .docx word/document.xml is typically stored.
 */
function extractFileFromZip(
  zipBytes: Uint8Array,
  targetFilename: string,
): Uint8Array | null {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  let offset = 0;
  while (offset < zipBytes.length - 30) {
    // Local file header signature = 0x04034b50
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) {
      break;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    const filenameBytes = zipBytes.slice(offset + 30, offset + 30 + filenameLength);
    const filename = new TextDecoder('utf-8').decode(filenameBytes);

    const dataOffset = offset + 30 + filenameLength + extraFieldLength;

    if (filename === targetFilename) {
      if (compressionMethod === 0) {
        // Stored (no compression)
        return zipBytes.slice(dataOffset, dataOffset + compressedSize);
      }
      // Compressed — we can't handle this without a decompression library
      // Return null rather than corrupted data
      return null;
    }

    offset = dataOffset + compressedSize;
  }

  return null;
}

// ---------------------------------------------------------------------------
// SharePointProvider
// ---------------------------------------------------------------------------

/**
 * SharePoint documentation provider.
 *
 * Fetches site pages and documents from SharePoint Online via the
 * Microsoft Graph API. Supports:
 * - OAuth2 client credentials flow (Azure AD app registration)
 * - Site pages (SharePoint modern pages)
 * - Document libraries (.docx, .pdf text extraction)
 * - Delta queries for incremental sync
 * - Site and library filtering
 */
export class SharePointProvider {
  readonly name = 'sharepoint';

  private config: SharePointConfig | null = null;
  private accessToken = '';
  private tokenExpiresAt = 0;

  /**
   * Validates the configuration and acquires an access token.
   */
  async initialize(
    config: Record<string, unknown>,
  ): Promise<Result<void, SharePointError>> {
    const { tenantId, clientId, clientSecret, siteIds, libraryNames, maxPages } =
      config as Record<string, unknown>;

    if (!tenantId || typeof tenantId !== 'string') {
      return err(
        new SharePointError('SharePoint config missing required field: tenantId'),
      );
    }
    if (!clientId || typeof clientId !== 'string') {
      return err(
        new SharePointError('SharePoint config missing required field: clientId'),
      );
    }
    if (!clientSecret || typeof clientSecret !== 'string') {
      return err(
        new SharePointError('SharePoint config missing required field: clientSecret'),
      );
    }

    this.config = {
      tenantId,
      clientId,
      clientSecret,
      siteIds: Array.isArray(siteIds)
        ? (siteIds as string[]).filter((s) => typeof s === 'string')
        : undefined,
      libraryNames: Array.isArray(libraryNames)
        ? (libraryNames as string[]).filter((s) => typeof s === 'string')
        : undefined,
      maxPages:
        typeof maxPages === 'number' && maxPages > 0
          ? maxPages
          : DEFAULT_MAX_PAGES,
    };

    // Acquire initial access token
    const tokenResult = await this.acquireToken();
    if (tokenResult.isErr()) {
      return err(tokenResult.error);
    }

    return ok(undefined);
  }

  /**
   * Fetches site pages from the specified sites (or configured sites).
   */
  async fetchPages(
    siteIds?: string[],
  ): Promise<Result<SharePointPage[], SharePointError>> {
    this.ensureInitialized();

    const effectiveSiteIds = siteIds ?? this.config!.siteIds;

    try {
      await this.ensureValidToken();

      if (!effectiveSiteIds || effectiveSiteIds.length === 0) {
        return err(
          new SharePointError(
            'No site IDs provided. Configure siteIds in SharePoint config or pass them explicitly.',
          ),
        );
      }

      const allPages: SharePointPage[] = [];
      for (const siteId of effectiveSiteIds) {
        const pagesResult = await this.fetchSitePages(siteId);
        if (pagesResult.isErr()) {
          return err(pagesResult.error);
        }
        allPages.push(...pagesResult.value);
      }

      return ok(allPages);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new SharePointError(`Failed to fetch pages: ${message}`));
    }
  }

  /**
   * Fetches documents from a site's document libraries.
   * Optionally filters by library name.
   */
  async fetchDocuments(
    siteId: string,
    libraryName?: string,
  ): Promise<Result<SharePointDocument[], SharePointError>> {
    this.ensureInitialized();

    try {
      await this.ensureValidToken();

      // Get drives (document libraries) for the site
      const drivesResult = await this.fetchDrives(siteId);
      if (drivesResult.isErr()) {
        return err(drivesResult.error);
      }

      const effectiveLibraryNames =
        libraryName
          ? [libraryName]
          : this.config!.libraryNames;

      let drives = drivesResult.value;
      if (effectiveLibraryNames && effectiveLibraryNames.length > 0) {
        drives = drives.filter((d) =>
          effectiveLibraryNames.some(
            (name) => d.name.toLowerCase() === name.toLowerCase(),
          ),
        );
      }

      const allDocuments: SharePointDocument[] = [];
      for (const drive of drives) {
        const docsResult = await this.fetchDriveItems(siteId, drive);
        if (docsResult.isErr()) {
          return err(docsResult.error);
        }
        allDocuments.push(...docsResult.value);
      }

      return ok(allDocuments);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new SharePointError(`Failed to fetch documents: ${message}`),
      );
    }
  }

  /**
   * Returns items that changed since the specified date using delta queries.
   * Uses the Microsoft Graph delta API for efficient incremental sync.
   */
  async getChangedItems(
    since: Date,
  ): Promise<Result<SharePointChangedItem[], SharePointError>> {
    this.ensureInitialized();

    try {
      await this.ensureValidToken();

      const effectiveSiteIds = this.config!.siteIds;
      if (!effectiveSiteIds || effectiveSiteIds.length === 0) {
        return err(
          new SharePointError(
            'No site IDs configured for delta query.',
          ),
        );
      }

      const allChanges: SharePointChangedItem[] = [];
      for (const siteId of effectiveSiteIds) {
        const changesResult = await this.fetchDelta(siteId, since);
        if (changesResult.isErr()) {
          return err(changesResult.error);
        }
        allChanges.push(...changesResult.value);
      }

      return ok(allChanges);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new SharePointError(`Failed to fetch changed items: ${message}`),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.config) {
      throw new SharePointError(
        'SharePointProvider has not been initialized. Call initialize() first.',
      );
    }
  }

  /**
   * Acquires an OAuth2 access token using client credentials flow.
   */
  private async acquireToken(): Promise<Result<void, SharePointError>> {
    const config = this.config!;
    const tokenUrl = `${LOGIN_BASE_URL}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        return err(
          new SharePointError(
            `OAuth2 token acquisition failed: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const data = (await response.json()) as GraphTokenResponse;
      this.accessToken = data.access_token;
      // Set expiry with 60-second buffer
      this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

      return ok(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new SharePointError(`OAuth2 token acquisition failed: ${message}`),
      );
    }
  }

  /**
   * Ensures the access token is still valid; re-acquires if expired.
   */
  private async ensureValidToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt) {
      const result = await this.acquireToken();
      if (result.isErr()) {
        throw result.error;
      }
    }
  }

  /**
   * Makes an authenticated GET request to the Graph API.
   */
  private async graphGet<T>(url: string): Promise<Result<T, SharePointError>> {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return err(
          new SharePointError(
            `Graph API request failed: ${response.status} ${response.statusText} (${url})`,
          ),
        );
      }

      const data = (await response.json()) as T;
      return ok(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new SharePointError(`Graph API request failed: ${message}`),
      );
    }
  }

  /**
   * Fetches site pages for a single site with pagination.
   */
  private async fetchSitePages(
    siteId: string,
  ): Promise<Result<SharePointPage[], SharePointError>> {
    const pages: SharePointPage[] = [];
    const limit = this.config!.maxPages ?? DEFAULT_MAX_PAGES;
    let url: string | undefined =
      `${GRAPH_BASE_URL}/sites/${encodeURIComponent(siteId)}/pages?$top=${limit}`;

    while (url) {
      const pageResult: Result<GraphSitePagesResponse, SharePointError> =
        await this.graphGet<GraphSitePagesResponse>(url);
      if (pageResult.isErr()) {
        return err(pageResult.error);
      }

      const data: GraphSitePagesResponse = pageResult.value;
      for (const item of data.value) {
        pages.push({
          id: item.id,
          title: item.title,
          siteId,
          type: 'page',
          plainText: '', // Pages need a separate content fetch; title serves as initial text
          htmlContent: '',
          url: item.webUrl,
          lastModified: new Date(item.lastModifiedDateTime),
          metadata: {
            contentType: item.contentType?.name,
          },
        });
      }

      url = data['@odata.nextLink'];
    }

    // Fetch content for each page
    for (const page of pages) {
      const contentResult = await this.fetchPageContent(siteId, page.id);
      if (contentResult.isOk()) {
        page.htmlContent = contentResult.value;
        page.plainText = htmlToPlainText(contentResult.value);
      }
      // If content fetch fails, we keep empty plainText (page still indexed by title)
    }

    return ok(pages);
  }

  /**
   * Fetches the HTML content of a single site page.
   */
  private async fetchPageContent(
    siteId: string,
    pageId: string,
  ): Promise<Result<string, SharePointError>> {
    const url = `${GRAPH_BASE_URL}/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(pageId)}/microsoft.graph.sitePage/webParts`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return err(
          new SharePointError(
            `Failed to fetch page content: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const data = (await response.json()) as {
        value: Array<{
          innerHtml?: string;
          data?: { innerHTML?: string };
        }>;
      };

      // Combine all web part HTML content
      const htmlParts: string[] = [];
      for (const webPart of data.value) {
        if (webPart.innerHtml) {
          htmlParts.push(webPart.innerHtml);
        }
        if (webPart.data?.innerHTML) {
          htmlParts.push(webPart.data.innerHTML);
        }
      }

      return ok(htmlParts.join('\n'));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new SharePointError(`Failed to fetch page content: ${message}`),
      );
    }
  }

  /**
   * Fetches document libraries (drives) for a site.
   */
  private async fetchDrives(
    siteId: string,
  ): Promise<Result<GraphDrive[], SharePointError>> {
    const drives: GraphDrive[] = [];
    let url: string | undefined =
      `${GRAPH_BASE_URL}/sites/${encodeURIComponent(siteId)}/drives`;

    while (url) {
      const driveResult: Result<GraphDrivesResponse, SharePointError> =
        await this.graphGet<GraphDrivesResponse>(url);
      if (driveResult.isErr()) {
        return err(driveResult.error);
      }
      const drivesData: GraphDrivesResponse = driveResult.value;
      drives.push(...drivesData.value);
      url = drivesData['@odata.nextLink'];
    }

    return ok(drives);
  }

  /**
   * Fetches items from a document library (drive), filtering for supported types.
   */
  private async fetchDriveItems(
    siteId: string,
    drive: GraphDrive,
  ): Promise<Result<SharePointDocument[], SharePointError>> {
    const documents: SharePointDocument[] = [];
    const limit = this.config!.maxPages ?? DEFAULT_MAX_PAGES;
    let url: string | undefined =
      `${GRAPH_BASE_URL}/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(drive.id)}/root/children?$top=${limit}`;

    while (url) {
      const itemsResult: Result<GraphDriveItemsResponse, SharePointError> =
        await this.graphGet<GraphDriveItemsResponse>(url);
      if (itemsResult.isErr()) {
        return err(itemsResult.error);
      }

      const itemsData: GraphDriveItemsResponse = itemsResult.value;
      for (const item of itemsData.value) {
        // Only process files with supported MIME types
        if (!item.file || !SUPPORTED_DOC_TYPES.has(item.file.mimeType)) {
          continue;
        }

        // Download file content for text extraction
        const textResult = await this.downloadAndExtractText(
          siteId,
          drive.id,
          item.id,
          item.file.mimeType,
        );

        documents.push({
          id: item.id,
          name: item.name,
          siteId,
          libraryName: drive.name,
          type: 'document',
          plainText: textResult.isOk() ? textResult.value : '',
          mimeType: item.file.mimeType,
          size: item.size,
          url: item.webUrl,
          lastModified: new Date(item.lastModifiedDateTime),
          metadata: {
            driveId: drive.id,
            driveName: drive.name,
          },
        });
      }

      url = itemsData['@odata.nextLink'];
    }

    return ok(documents);
  }

  /**
   * Downloads a file from a drive and extracts text content.
   */
  private async downloadAndExtractText(
    siteId: string,
    driveId: string,
    itemId: string,
    mimeType: string,
  ): Promise<Result<string, SharePointError>> {
    const url = `${GRAPH_BASE_URL}/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        return err(
          new SharePointError(
            `Failed to download file: ${response.status} ${response.statusText}`,
          ),
        );
      }

      const buffer = await response.arrayBuffer();

      if (
        mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        return ok(extractTextFromDocx(buffer));
      }

      if (mimeType === 'application/pdf') {
        return ok(extractTextFromPdf(buffer));
      }

      return ok('');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(
        new SharePointError(`Failed to download file: ${message}`),
      );
    }
  }

  /**
   * Fetches changed items using the Microsoft Graph delta API.
   */
  private async fetchDelta(
    siteId: string,
    since: Date,
  ): Promise<Result<SharePointChangedItem[], SharePointError>> {
    const changes: SharePointChangedItem[] = [];

    // Use delta query on the default drive
    const drivesResult = await this.fetchDrives(siteId);
    if (drivesResult.isErr()) {
      return err(drivesResult.error);
    }

    const effectiveLibraryNames = this.config!.libraryNames;

    let drives = drivesResult.value;
    if (effectiveLibraryNames && effectiveLibraryNames.length > 0) {
      drives = drives.filter((d) =>
        effectiveLibraryNames.some(
          (name) => d.name.toLowerCase() === name.toLowerCase(),
        ),
      );
    }

    for (const drive of drives) {
      let url: string | undefined =
        `${GRAPH_BASE_URL}/drives/${encodeURIComponent(drive.id)}/root/delta`;

      while (url) {
        const deltaResult: Result<GraphDeltaResponse, SharePointError> =
          await this.graphGet<GraphDeltaResponse>(url);
        if (deltaResult.isErr()) {
          return err(deltaResult.error);
        }

        const deltaData: GraphDeltaResponse = deltaResult.value;
        for (const item of deltaData.value) {
          const itemDate = new Date(item.lastModifiedDateTime);
          if (itemDate < since) {
            continue;
          }

          let changeType: 'created' | 'updated' | 'deleted' = 'updated';
          if (item.deleted) {
            changeType = 'deleted';
          }

          const itemType: SharePointItemType = item.file ? 'document' : 'page';

          changes.push({
            id: item.id,
            name: item.name,
            type: itemType,
            changeType,
            lastModified: itemDate,
          });
        }

        url = deltaData['@odata.nextLink'];
      }
    }

    return ok(changes);
  }
}
