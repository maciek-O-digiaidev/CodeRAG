import type { Request, Response, NextFunction } from 'express';

/**
 * Parsed API key with optional admin role.
 */
export interface ApiKeyEntry {
  readonly key: string;
  readonly admin: boolean;
}

/**
 * Parse the CODERAG_API_KEYS env var.
 *
 * Format: comma-separated keys. Keys suffixed with `:admin` grant admin privileges.
 * Example: "key1,key2:admin,key3"
 */
export function parseApiKeys(envValue: string | undefined): ReadonlyArray<ApiKeyEntry> {
  if (!envValue || envValue.trim() === '') {
    return [];
  }

  return envValue
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (entry.endsWith(':admin')) {
        return { key: entry.slice(0, -6), admin: true };
      }
      return { key: entry, admin: false };
    });
}

/**
 * Express request with authenticated API key information.
 */
export interface AuthenticatedRequest extends Request {
  apiKey?: ApiKeyEntry;
}

/**
 * Create an authentication middleware that validates API keys.
 *
 * Accepts keys from:
 * - `Authorization: Bearer <key>` header
 * - `X-API-Key: <key>` header
 *
 * When no API keys are configured (empty CODERAG_API_KEYS),
 * authentication is disabled and all requests pass through.
 */
export function createAuthMiddleware(
  apiKeys: ReadonlyArray<ApiKeyEntry>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If no keys configured, auth is disabled (development mode)
    if (apiKeys.length === 0) {
      next();
      return;
    }

    const key = extractApiKey(req);

    if (!key) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing API key. Provide via Authorization: Bearer <key> or X-API-Key: <key> header.',
      });
      return;
    }

    const entry = apiKeys.find((k) => k.key === key);

    if (!entry) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key.',
      });
      return;
    }

    // Attach the validated key entry to the request
    (req as AuthenticatedRequest).apiKey = entry;
    next();
  };
}

/**
 * Middleware that requires admin privileges on the API key.
 * Must be used after createAuthMiddleware.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;

  // If no apiKey is set, auth is disabled (development mode) — allow through
  if (!authReq.apiKey && !res.headersSent) {
    next();
    return;
  }

  if (!authReq.apiKey?.admin) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Admin privileges required for this endpoint.',
    });
    return;
  }

  next();
}

function extractApiKey(req: Request): string | undefined {
  // Check Authorization: Bearer <key>
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // Check X-API-Key: <key>
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim().length > 0) {
    return apiKeyHeader.trim();
  }

  return undefined;
}
