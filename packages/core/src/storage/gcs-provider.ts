import { ok, err, type Result } from 'neverthrow';
import { request as httpsRequest } from 'node:https';
import { createSign } from 'node:crypto';
import type { CloudStorageProvider, GCSConfig, GCSCredentials } from './types.js';
import { StorageError } from './types.js';

// ---------------------------------------------------------------------------
// Google Cloud OAuth2 JWT helpers
// ---------------------------------------------------------------------------

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function createJwt(credentials: GCSCredentials, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + 3600; // 1 hour

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.full_control',
    aud: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(credentials.private_key, 'base64url');

  return `${signingInput}.${signature}`;
}

async function getAccessToken(credentials: GCSCredentials): Promise<string> {
  const jwt = createJwt(credentials, new Date());
  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token';
  const tokenUrl = new URL(tokenUri);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }).toString();

  return new Promise<string>((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: tokenUrl.hostname,
        path: tokenUrl.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf-8');
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            const parsed = JSON.parse(responseBody) as { access_token?: string };
            if (parsed.access_token) {
              resolve(parsed.access_token);
            } else {
              reject(new Error('No access_token in OAuth response'));
            }
          } else {
            reject(new Error(`OAuth token request failed (${statusCode}): ${responseBody}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// GCSStorageProvider
// ---------------------------------------------------------------------------

/**
 * Cloud storage provider for Google Cloud Storage.
 * Uses node:https with service account JWT authentication — no external SDK dependency.
 */
export class GCSStorageProvider implements CloudStorageProvider {
  private readonly config: GCSConfig;
  private readonly apiHost = 'storage.googleapis.com';

  private cachedToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: GCSConfig) {
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async upload(key: string, data: Buffer): Promise<Result<void, StorageError>> {
    try {
      const token = await this.getToken();
      await this.gcsRequest('POST', key, token, data);
      return ok(undefined);
    } catch (error: unknown) {
      return err(new StorageError(`GCS upload failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async download(key: string): Promise<Result<Buffer, StorageError>> {
    try {
      const token = await this.getToken();
      const body = await this.gcsRequest('GET', key, token);
      return ok(body);
    } catch (error: unknown) {
      return err(new StorageError(`GCS download failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    try {
      const token = await this.getToken();
      await this.gcsRequest('DELETE', key, token);
      return ok(undefined);
    } catch (error: unknown) {
      return err(new StorageError(`GCS delete failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async list(prefix: string): Promise<Result<readonly string[], StorageError>> {
    try {
      const token = await this.getToken();
      const query = `prefix=${encodeURIComponent(prefix)}`;
      const body = await this.gcsRequest('LIST', '', token, undefined, query);
      const json = JSON.parse(body.toString('utf-8')) as { items?: Array<{ name?: string }> };
      const keys = (json.items ?? [])
        .map((item) => item.name)
        .filter((name): name is string => name !== undefined);
      return ok(keys);
    } catch (error: unknown) {
      return err(new StorageError(`GCS list failed for prefix "${prefix}": ${errorMessage(error)}`));
    }
  }

  async exists(key: string): Promise<Result<boolean, StorageError>> {
    try {
      const token = await this.getToken();
      await this.gcsRequest('HEAD', key, token);
      return ok(true);
    } catch (error: unknown) {
      const msg = errorMessage(error);
      if (msg.includes('404') || msg.includes('Not Found')) {
        return ok(false);
      }
      return err(new StorageError(`GCS exists check failed for "${key}": ${msg}`));
    }
  }

  getUrl(key: string): Result<string, StorageError> {
    return ok(`https://${this.apiHost}/storage/v1/b/${this.config.bucket}/o/${encodeURIComponent(key)}`);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiry) {
      return this.cachedToken;
    }

    const token = await getAccessToken(this.config.credentials);
    this.cachedToken = token;
    // Refresh 5 minutes before actual expiry
    this.tokenExpiry = now + 55 * 60 * 1000;
    return token;
  }

  private async gcsRequest(
    method: string,
    key: string,
    token: string,
    body?: Buffer,
    query?: string,
  ): Promise<Buffer> {
    // GCS JSON API paths
    let path: string;
    let httpMethod: string;

    if (method === 'POST') {
      // Upload via media upload endpoint
      path = `/upload/storage/v1/b/${this.config.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`;
      httpMethod = 'POST';
    } else if (method === 'LIST') {
      // List objects
      path = `/storage/v1/b/${this.config.bucket}/o`;
      if (query) {
        path += `?${query}`;
      }
      httpMethod = 'GET';
    } else if (method === 'GET') {
      path = `/storage/v1/b/${this.config.bucket}/o/${encodeURIComponent(key)}?alt=media`;
      httpMethod = 'GET';
    } else if (method === 'HEAD') {
      // Use GET metadata endpoint to check existence
      path = `/storage/v1/b/${this.config.bucket}/o/${encodeURIComponent(key)}`;
      httpMethod = 'GET';
    } else {
      // DELETE
      path = `/storage/v1/b/${this.config.bucket}/o/${encodeURIComponent(key)}`;
      httpMethod = method;
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
    };

    if (body && method === 'POST') {
      headers['content-length'] = body.length.toString();
      headers['content-type'] = 'application/octet-stream';
    }

    return new Promise<Buffer>((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: this.apiHost,
          path,
          method: httpMethod,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks);
            const statusCode = res.statusCode ?? 0;
            if (statusCode >= 200 && statusCode < 300) {
              resolve(responseBody);
            } else if (statusCode === 404) {
              reject(new Error('404 Not Found'));
            } else {
              reject(new Error(`GCS responded with status ${statusCode}: ${responseBody.toString('utf-8')}`));
            }
          });
        },
      );

      req.on('error', reject);

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
