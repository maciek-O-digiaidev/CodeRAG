import { ok, err, type Result } from 'neverthrow';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createHmac, createHash } from 'node:crypto';
import type { CloudStorageProvider, S3Config } from './types.js';
import { StorageError } from './types.js';

// ---------------------------------------------------------------------------
// AWS Signature V4 helpers
// ---------------------------------------------------------------------------

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// S3StorageProvider
// ---------------------------------------------------------------------------

/**
 * Cloud storage provider for Amazon S3 and S3-compatible stores (MinIO).
 * Uses node:https with AWS Signature V4 — no external SDK dependency.
 */
export class S3StorageProvider implements CloudStorageProvider {
  private readonly config: S3Config;
  private readonly host: string;
  private readonly protocol: 'https' | 'http';
  private readonly port: number | undefined;

  constructor(config: S3Config) {
    this.config = config;

    if (config.endpoint) {
      const url = new URL(config.endpoint);
      this.host = url.hostname;
      this.protocol = url.protocol === 'http:' ? 'http' : 'https';
      this.port = url.port ? parseInt(url.port, 10) : undefined;
    } else {
      this.host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
      this.protocol = 'https';
      this.port = undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async upload(key: string, data: Buffer): Promise<Result<void, StorageError>> {
    try {
      await this.s3Request('PUT', key, data);
      return ok(undefined);
    } catch (error: unknown) {
      return err(new StorageError(`S3 upload failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async download(key: string): Promise<Result<Buffer, StorageError>> {
    try {
      const body = await this.s3Request('GET', key);
      return ok(body);
    } catch (error: unknown) {
      return err(new StorageError(`S3 download failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    try {
      await this.s3Request('DELETE', key);
      return ok(undefined);
    } catch (error: unknown) {
      return err(new StorageError(`S3 delete failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async list(prefix: string): Promise<Result<readonly string[], StorageError>> {
    try {
      const body = await this.s3Request('GET', '', undefined, `list-type=2&prefix=${encodeURIComponent(prefix)}`);
      const xml = body.toString('utf-8');
      const keys = extractXmlKeys(xml);
      return ok(keys);
    } catch (error: unknown) {
      return err(new StorageError(`S3 list failed for prefix "${prefix}": ${errorMessage(error)}`));
    }
  }

  async exists(key: string): Promise<Result<boolean, StorageError>> {
    try {
      await this.s3Request('HEAD', key);
      return ok(true);
    } catch (error: unknown) {
      const msg = errorMessage(error);
      if (msg.includes('404') || msg.includes('Not Found') || msg.includes('NoSuchKey')) {
        return ok(false);
      }
      return err(new StorageError(`S3 exists check failed for "${key}": ${msg}`));
    }
  }

  getUrl(key: string): Result<string, StorageError> {
    if (this.config.endpoint) {
      return ok(`${this.config.endpoint}/${this.config.bucket}/${encodeURIComponent(key)}`);
    }
    return ok(`https://${this.host}/${encodeURIComponent(key)}`);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async s3Request(
    method: string,
    key: string,
    body?: Buffer,
    query?: string,
  ): Promise<Buffer> {
    const now = new Date();
    const { amzDate, dateStamp } = formatAmzDate(now);

    // Build canonical path
    const pathSegment = this.config.endpoint
      ? `/${this.config.bucket}/${key}`
      : `/${key}`;
    const canonicalUri = pathSegment || '/';
    const canonicalQueryString = query ?? '';

    const payloadHash = sha256(body ?? Buffer.alloc(0));

    const headers: Record<string, string> = {
      host: this.port ? `${this.host}:${this.port}` : this.host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    };

    if (body && method === 'PUT') {
      headers['content-length'] = body.length.toString();
      headers['content-type'] = 'application/octet-stream';
    }

    // Sort headers for canonical request
    const signedHeaderKeys = Object.keys(headers).sort();
    const signedHeaders = signedHeaderKeys.join(';');
    const canonicalHeaders = signedHeaderKeys
      .map((k) => `${k}:${headers[k]!}\n`)
      .join('');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join('\n');

    const signingKey = getSignatureKey(
      this.config.secretAccessKey,
      dateStamp,
      this.config.region,
      's3',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const requestFn = this.protocol === 'http' ? httpRequest : httpsRequest;

    return new Promise<Buffer>((resolve, reject) => {
      const path = canonicalQueryString
        ? `${canonicalUri}?${canonicalQueryString}`
        : canonicalUri;

      const req = requestFn(
        {
          hostname: this.host,
          port: this.port,
          path,
          method,
          headers: {
            ...headers,
            authorization,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks);
            const statusCode = res.statusCode ?? 0;
            if (statusCode >= 200 && statusCode < 300) {
              resolve(responseBody);
            } else if (method === 'HEAD' && statusCode === 404) {
              reject(new Error(`404 Not Found`));
            } else {
              reject(new Error(`S3 responded with status ${statusCode}: ${responseBody.toString('utf-8')}`));
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

/**
 * Extract <Key>...</Key> values from S3 ListObjectsV2 XML response.
 */
function extractXmlKeys(xml: string): string[] {
  const keys: string[] = [];
  const regex = /<Key>([^<]+)<\/Key>/g;
  let match = regex.exec(xml);
  while (match) {
    const key = match[1];
    if (key !== undefined) {
      keys.push(key);
    }
    match = regex.exec(xml);
  }
  return keys;
}
