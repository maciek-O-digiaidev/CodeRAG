import type { Result } from 'neverthrow';

// ---------------------------------------------------------------------------
// StorageError
// ---------------------------------------------------------------------------

/**
 * Error class for cloud storage operations.
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

// ---------------------------------------------------------------------------
// Cloud Storage Provider Interface
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic interface for cloud object storage.
 * All operations return Result<T, StorageError> for safe error handling.
 */
export interface CloudStorageProvider {
  /**
   * Upload data to the given key.
   */
  upload(key: string, data: Buffer): Promise<Result<void, StorageError>>;

  /**
   * Download data from the given key.
   */
  download(key: string): Promise<Result<Buffer, StorageError>>;

  /**
   * Delete the object at the given key.
   */
  delete(key: string): Promise<Result<void, StorageError>>;

  /**
   * List object keys matching a prefix.
   */
  list(prefix: string): Promise<Result<readonly string[], StorageError>>;

  /**
   * Check whether an object exists at the given key.
   */
  exists(key: string): Promise<Result<boolean, StorageError>>;

  /**
   * Get a URL (or presigned URL) for the given key.
   */
  getUrl(key: string): Result<string, StorageError>;
}

// ---------------------------------------------------------------------------
// Cloud Storage Config — discriminated union
// ---------------------------------------------------------------------------

export interface S3Config {
  readonly provider: 's3';
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Optional custom endpoint for S3-compatible stores like MinIO. */
  readonly endpoint?: string;
}

export interface AzureBlobConfig {
  readonly provider: 'azure-blob';
  readonly accountName: string;
  readonly accountKey: string;
  readonly containerName: string;
}

export interface GCSConfig {
  readonly provider: 'gcs';
  readonly projectId: string;
  readonly bucket: string;
  /** Service account JSON key (parsed object). */
  readonly credentials: GCSCredentials;
}

export interface GCSCredentials {
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri: string;
}

export type CloudStorageConfig = S3Config | AzureBlobConfig | GCSConfig;
