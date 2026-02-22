import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureBlobStorageProvider } from './azure-blob-provider.js';
import type { AzureBlobConfig } from './types.js';

// ---------------------------------------------------------------------------
// Mock node:https
// ---------------------------------------------------------------------------

const { mockHttpsRequest } = vi.hoisted(() => ({
  mockHttpsRequest: vi.fn(),
}));

vi.mock('node:https', () => ({ request: mockHttpsRequest }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AzureBlobConfig = {
  provider: 'azure-blob',
  accountName: 'teststorage',
  accountKey: Buffer.from('test-key-value-for-hmac-signing-placeholder!!').toString('base64'),
  containerName: 'test-container',
};

function setupMockResponse(statusCode: number, body: string | Buffer): void {
  const bodyBuf = typeof body === 'string' ? Buffer.from(body) : body;

  mockHttpsRequest.mockImplementation(
    (_options: unknown, callback: (res: { statusCode: number; on: ReturnType<typeof vi.fn> }) => void) => {
      const res = {
        statusCode,
        on: vi.fn((event: string, handler: (data?: Buffer) => void) => {
          if (event === 'data') {
            process.nextTick(() => handler(bodyBuf));
          }
          if (event === 'end') {
            process.nextTick(() => process.nextTick(() => handler()));
          }
          return res;
        }),
      };

      process.nextTick(() => callback(res));

      return {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };
    },
  );
}

function setupNetworkError(errorMessage: string): void {
  mockHttpsRequest.mockImplementation(
    (_options: unknown, _callback: unknown) => {
      const req = {
        on: vi.fn((event: string, handler: (err: Error) => void) => {
          if (event === 'error') {
            process.nextTick(() => handler(new Error(errorMessage)));
          }
          return req;
        }),
        write: vi.fn(),
        end: vi.fn(),
      };
      return req;
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AzureBlobStorageProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockResponse(200, '');
  });

  describe('constructor', () => {
    it('should set host from account name', () => {
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);
      const urlResult = provider.getUrl('test-key');
      expect(urlResult.isOk()).toBe(true);
      if (urlResult.isOk()) {
        expect(urlResult.value).toContain('teststorage.blob.core.windows.net');
      }
    });
  });

  describe('upload', () => {
    it('should return ok on successful upload', async () => {
      setupMockResponse(201, '');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.upload('my-blob', Buffer.from('hello'));

      expect(result.isOk()).toBe(true);
    });

    it('should return err on HTTP error', async () => {
      setupMockResponse(500, 'InternalServerError');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.upload('my-blob', Buffer.from('hello'));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Azure upload failed');
        expect(result.error.name).toBe('StorageError');
      }
    });

    it('should return err on network error', async () => {
      setupNetworkError('ECONNREFUSED');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.upload('my-blob', Buffer.from('hello'));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });

    it('should include SharedKey authorization header', async () => {
      setupMockResponse(201, '');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      await provider.upload('my-blob', Buffer.from('hello'));

      const options = mockHttpsRequest.mock.calls[0]?.[0] as { headers?: Record<string, string> };
      expect(options.headers).toBeDefined();
      expect(options.headers!['authorization']).toContain('SharedKey teststorage:');
    });
  });

  describe('download', () => {
    it('should return buffer on success', async () => {
      const expectedData = Buffer.from('file-contents');
      setupMockResponse(200, expectedData);
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.download('my-blob');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.toString()).toBe('file-contents');
      }
    });

    it('should return err on 404', async () => {
      setupMockResponse(404, 'BlobNotFound');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.download('missing-blob');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Azure download failed');
      }
    });

    it('should return err on 403', async () => {
      setupMockResponse(403, 'AuthorizationFailure');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.download('forbidden-blob');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Azure download failed');
      }
    });
  });

  describe('delete', () => {
    it('should return ok on successful delete', async () => {
      setupMockResponse(202, '');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.delete('my-blob');

      expect(result.isOk()).toBe(true);
    });

    it('should return err on failure', async () => {
      setupMockResponse(500, 'Error');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.delete('my-blob');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Azure delete failed');
      }
    });
  });

  describe('list', () => {
    it('should parse XML response and return blob names', async () => {
      const xml = `<?xml version="1.0"?>
<EnumerationResults>
  <Blobs>
    <Blob><Name>file1.ts</Name></Blob>
    <Blob><Name>file2.ts</Name></Blob>
  </Blobs>
</EnumerationResults>`;
      setupMockResponse(200, xml);
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.list('src/');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(['file1.ts', 'file2.ts']);
      }
    });

    it('should return empty array when no blobs match', async () => {
      const xml = `<?xml version="1.0"?><EnumerationResults><Blobs></Blobs></EnumerationResults>`;
      setupMockResponse(200, xml);
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.list('nonexistent/');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return err on failure', async () => {
      setupMockResponse(500, 'Error');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.list('src/');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Azure list failed');
      }
    });
  });

  describe('exists', () => {
    it('should return true when blob exists', async () => {
      setupMockResponse(200, '');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.exists('my-blob');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false when blob does not exist (404)', async () => {
      setupMockResponse(404, '');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.exists('missing-blob');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });

    it('should return err on non-404 error', async () => {
      setupMockResponse(500, 'InternalError');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      const result = await provider.exists('error-blob');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Azure exists check failed');
      }
    });
  });

  describe('getUrl', () => {
    it('should return Azure Blob URL', () => {
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);
      const result = provider.getUrl('my-file.ts');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(
          'https://teststorage.blob.core.windows.net/test-container/my-file.ts',
        );
      }
    });
  });

  describe('request headers', () => {
    it('should include x-ms-version header', async () => {
      setupMockResponse(200, '');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      await provider.download('my-blob');

      const options = mockHttpsRequest.mock.calls[0]?.[0] as { headers?: Record<string, string> };
      expect(options.headers!['x-ms-version']).toBeDefined();
    });

    it('should include x-ms-date header', async () => {
      setupMockResponse(200, '');
      const provider = new AzureBlobStorageProvider(DEFAULT_CONFIG);

      await provider.download('my-blob');

      const options = mockHttpsRequest.mock.calls[0]?.[0] as { headers?: Record<string, string> };
      expect(options.headers!['x-ms-date']).toBeDefined();
    });
  });
});
