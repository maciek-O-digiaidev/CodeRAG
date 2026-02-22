import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3StorageProvider } from './s3-provider.js';
import type { S3Config } from './types.js';

// ---------------------------------------------------------------------------
// Mock node:https and node:http
// ---------------------------------------------------------------------------

const { mockHttpsRequest, mockHttpRequest } = vi.hoisted(() => ({
  mockHttpsRequest: vi.fn(),
  mockHttpRequest: vi.fn(),
}));

vi.mock('node:https', () => ({ request: mockHttpsRequest }));
vi.mock('node:http', () => ({ request: mockHttpRequest }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: S3Config = {
  provider: 's3',
  bucket: 'test-bucket',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
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

function setupMockResponseForHttp(statusCode: number, body: string | Buffer): void {
  const bodyBuf = typeof body === 'string' ? Buffer.from(body) : body;

  mockHttpRequest.mockImplementation(
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S3StorageProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockResponse(200, '');
  });

  describe('constructor', () => {
    it('should set host from bucket and region for standard S3', () => {
      const provider = new S3StorageProvider(DEFAULT_CONFIG);
      const urlResult = provider.getUrl('test-key');
      expect(urlResult.isOk()).toBe(true);
      if (urlResult.isOk()) {
        expect(urlResult.value).toContain('test-bucket.s3.us-east-1.amazonaws.com');
      }
    });

    it('should use custom endpoint for S3-compatible stores', () => {
      const config: S3Config = {
        ...DEFAULT_CONFIG,
        endpoint: 'http://localhost:9000',
      };
      const provider = new S3StorageProvider(config);
      const urlResult = provider.getUrl('test-key');
      expect(urlResult.isOk()).toBe(true);
      if (urlResult.isOk()) {
        expect(urlResult.value).toContain('http://localhost:9000/test-bucket/');
      }
    });
  });

  describe('upload', () => {
    it('should return ok on successful upload', async () => {
      setupMockResponse(200, '');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.upload('my-key', Buffer.from('hello'));

      expect(result.isOk()).toBe(true);
    });

    it('should return err on HTTP error', async () => {
      setupMockResponse(500, 'InternalServerError');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.upload('my-key', Buffer.from('hello'));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('S3 upload failed');
        expect(result.error.name).toBe('StorageError');
      }
    });

    it('should return err on network error', async () => {
      setupNetworkError('ECONNREFUSED');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.upload('my-key', Buffer.from('hello'));

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('ECONNREFUSED');
      }
    });

    it('should call write with body data', async () => {
      setupMockResponse(200, '');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);
      const data = Buffer.from('test-data');

      await provider.upload('my-key', data);

      const lastCall = mockHttpsRequest.mock.results[0]?.value;
      expect(lastCall.write).toHaveBeenCalledWith(data);
    });
  });

  describe('download', () => {
    it('should return buffer on success', async () => {
      const expectedData = Buffer.from('file-contents');
      setupMockResponse(200, expectedData);
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.download('my-key');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.toString()).toBe('file-contents');
      }
    });

    it('should return err on 404', async () => {
      setupMockResponse(404, 'NoSuchKey');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.download('missing-key');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('S3 download failed');
      }
    });

    it('should return err on 403', async () => {
      setupMockResponse(403, 'AccessDenied');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.download('forbidden-key');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('S3 download failed');
      }
    });
  });

  describe('delete', () => {
    it('should return ok on successful delete', async () => {
      setupMockResponse(204, '');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.delete('my-key');

      expect(result.isOk()).toBe(true);
    });

    it('should return err on failure', async () => {
      setupMockResponse(500, 'Error');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.delete('my-key');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('S3 delete failed');
      }
    });
  });

  describe('list', () => {
    it('should parse XML response and return keys', async () => {
      const xml = `<?xml version="1.0"?>
<ListBucketResult>
  <Contents><Key>file1.ts</Key></Contents>
  <Contents><Key>file2.ts</Key></Contents>
</ListBucketResult>`;
      setupMockResponse(200, xml);
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.list('src/');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(['file1.ts', 'file2.ts']);
      }
    });

    it('should return empty array when no keys match', async () => {
      const xml = `<?xml version="1.0"?><ListBucketResult></ListBucketResult>`;
      setupMockResponse(200, xml);
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.list('nonexistent/');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return err on failure', async () => {
      setupMockResponse(500, 'Error');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.list('src/');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('S3 list failed');
      }
    });
  });

  describe('exists', () => {
    it('should return true when object exists', async () => {
      setupMockResponse(200, '');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.exists('my-key');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false when object does not exist (404)', async () => {
      // HEAD request with 404 triggers reject with '404 Not Found'
      setupMockResponse(404, '');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.exists('missing-key');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });

    it('should return err on non-404 error', async () => {
      setupMockResponse(500, 'InternalError');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      const result = await provider.exists('error-key');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('S3 exists check failed');
      }
    });
  });

  describe('getUrl', () => {
    it('should return standard S3 URL', () => {
      const provider = new S3StorageProvider(DEFAULT_CONFIG);
      const result = provider.getUrl('my-file.ts');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/my-file.ts');
      }
    });

    it('should return custom endpoint URL', () => {
      const config: S3Config = { ...DEFAULT_CONFIG, endpoint: 'http://minio:9000' };
      const provider = new S3StorageProvider(config);
      const result = provider.getUrl('my-file.ts');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('http://minio:9000/test-bucket/my-file.ts');
      }
    });
  });

  describe('custom endpoint (MinIO)', () => {
    it('should use http for http:// endpoint', async () => {
      setupMockResponseForHttp(200, '');
      const config: S3Config = {
        ...DEFAULT_CONFIG,
        endpoint: 'http://localhost:9000',
      };
      const provider = new S3StorageProvider(config);

      const result = await provider.upload('test', Buffer.from('data'));

      expect(result.isOk()).toBe(true);
      expect(mockHttpRequest).toHaveBeenCalled();
    });

    it('should use https for https:// endpoint', async () => {
      setupMockResponse(200, '');
      const config: S3Config = {
        ...DEFAULT_CONFIG,
        endpoint: 'https://minio.example.com',
      };
      const provider = new S3StorageProvider(config);

      const result = await provider.upload('test', Buffer.from('data'));

      expect(result.isOk()).toBe(true);
      expect(mockHttpsRequest).toHaveBeenCalled();
    });
  });

  describe('AWS Signature V4', () => {
    it('should include Authorization header in request', async () => {
      setupMockResponse(200, '');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      await provider.upload('my-key', Buffer.from('hello'));

      const options = mockHttpsRequest.mock.calls[0]?.[0] as { headers?: Record<string, string> };
      expect(options.headers).toBeDefined();
      expect(options.headers!['authorization']).toContain('AWS4-HMAC-SHA256');
      expect(options.headers!['authorization']).toContain('Credential=AKIAIOSFODNN7EXAMPLE');
    });

    it('should include x-amz-date header', async () => {
      setupMockResponse(200, '');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      await provider.upload('my-key', Buffer.from('hello'));

      const options = mockHttpsRequest.mock.calls[0]?.[0] as { headers?: Record<string, string> };
      expect(options.headers!['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    });

    it('should include content-sha256 header', async () => {
      setupMockResponse(200, '');
      const provider = new S3StorageProvider(DEFAULT_CONFIG);

      await provider.upload('my-key', Buffer.from('hello'));

      const options = mockHttpsRequest.mock.calls[0]?.[0] as { headers?: Record<string, string> };
      expect(options.headers!['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
