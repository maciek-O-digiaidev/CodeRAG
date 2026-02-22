import { ok, err, type Result } from 'neverthrow';
import { request as httpsRequest } from 'node:https';
import { createHmac } from 'node:crypto';
import type { CloudStorageProvider, AzureBlobConfig } from './types.js';
import { StorageError } from './types.js';

// ---------------------------------------------------------------------------
// Azure Storage Shared Key helpers
// ---------------------------------------------------------------------------

function buildAuthorizationHeader(
  config: AzureBlobConfig,
  method: string,
  path: string,
  headers: Record<string, string>,
  queryParams?: string,
): string {
  const contentLength = headers['content-length'] ?? '';
  const contentType = headers['content-type'] ?? '';

  // Build canonicalized headers (x-ms-*)
  const msHeaders = Object.entries(headers)
    .filter(([k]) => k.startsWith('x-ms-'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('\n');

  // Build canonicalized resource
  let canonicalizedResource = `/${config.accountName}${path}`;
  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    const sortedParams = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of sortedParams) {
      canonicalizedResource += `\n${key}:${value}`;
    }
  }

  // StringToSign for SharedKey
  // https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
  const stringToSign = [
    method,               // VERB
    '',                   // Content-Encoding
    '',                   // Content-Language
    contentLength,        // Content-Length
    '',                   // Content-MD5
    contentType,          // Content-Type
    '',                   // Date
    '',                   // If-Modified-Since
    '',                   // If-Match
    '',                   // If-None-Match
    '',                   // If-Unmodified-Since
    '',                   // Range
    msHeaders,            // CanonicalizedHeaders
    canonicalizedResource, // CanonicalizedResource
  ].join('\n');

  const key = Buffer.from(config.accountKey, 'base64');
  const signature = createHmac('sha256', key).update(stringToSign, 'utf-8').digest('base64');

  return `SharedKey ${config.accountName}:${signature}`;
}

function formatRfc1123(date: Date): string {
  return date.toUTCString();
}

// ---------------------------------------------------------------------------
// AzureBlobStorageProvider
// ---------------------------------------------------------------------------

/**
 * Cloud storage provider for Azure Blob Storage.
 * Uses node:https with Shared Key authentication — no external SDK dependency.
 */
export class AzureBlobStorageProvider implements CloudStorageProvider {
  private readonly config: AzureBlobConfig;
  private readonly host: string;

  constructor(config: AzureBlobConfig) {
    this.config = config;
    this.host = `${config.accountName}.blob.core.windows.net`;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async upload(key: string, data: Buffer): Promise<Result<void, StorageError>> {
    try {
      await this.azureRequest('PUT', key, data);
      return ok(undefined);
    } catch (error: unknown) {
      return err(new StorageError(`Azure upload failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async download(key: string): Promise<Result<Buffer, StorageError>> {
    try {
      const body = await this.azureRequest('GET', key);
      return ok(body);
    } catch (error: unknown) {
      return err(new StorageError(`Azure download failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    try {
      await this.azureRequest('DELETE', key);
      return ok(undefined);
    } catch (error: unknown) {
      return err(new StorageError(`Azure delete failed for "${key}": ${errorMessage(error)}`));
    }
  }

  async list(prefix: string): Promise<Result<readonly string[], StorageError>> {
    try {
      const query = `restype=container&comp=list&prefix=${encodeURIComponent(prefix)}`;
      const body = await this.azureRequest('GET', '', undefined, query);
      const xml = body.toString('utf-8');
      const names = extractBlobNames(xml);
      return ok(names);
    } catch (error: unknown) {
      return err(new StorageError(`Azure list failed for prefix "${prefix}": ${errorMessage(error)}`));
    }
  }

  async exists(key: string): Promise<Result<boolean, StorageError>> {
    try {
      await this.azureRequest('HEAD', key);
      return ok(true);
    } catch (error: unknown) {
      const msg = errorMessage(error);
      if (msg.includes('404') || msg.includes('BlobNotFound')) {
        return ok(false);
      }
      return err(new StorageError(`Azure exists check failed for "${key}": ${msg}`));
    }
  }

  getUrl(key: string): Result<string, StorageError> {
    return ok(`https://${this.host}/${this.config.containerName}/${encodeURIComponent(key)}`);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async azureRequest(
    method: string,
    blobName: string,
    body?: Buffer,
    query?: string,
  ): Promise<Buffer> {
    const now = new Date();
    const dateStr = formatRfc1123(now);
    const apiVersion = '2023-11-03';

    const path = blobName
      ? `/${this.config.containerName}/${blobName}`
      : `/${this.config.containerName}`;

    const headers: Record<string, string> = {
      'x-ms-date': dateStr,
      'x-ms-version': apiVersion,
      'x-ms-blob-type': 'BlockBlob',
    };

    if (body && method === 'PUT') {
      headers['content-length'] = body.length.toString();
      headers['content-type'] = 'application/octet-stream';
    }

    const authorization = buildAuthorizationHeader(
      this.config,
      method,
      path,
      headers,
      query,
    );

    return new Promise<Buffer>((resolve, reject) => {
      const fullPath = query ? `${path}?${query}` : path;

      const req = httpsRequest(
        {
          hostname: this.host,
          path: fullPath,
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
              reject(new Error('404 BlobNotFound'));
            } else {
              reject(new Error(`Azure responded with status ${statusCode}: ${responseBody.toString('utf-8')}`));
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
 * Extract <Name>...</Name> values from Azure List Blobs XML response.
 */
function extractBlobNames(xml: string): string[] {
  const names: string[] = [];
  const regex = /<Name>([^<]+)<\/Name>/g;
  let match = regex.exec(xml);
  while (match) {
    const name = match[1];
    if (name !== undefined) {
      names.push(name);
    }
    match = regex.exec(xml);
  }
  return names;
}
