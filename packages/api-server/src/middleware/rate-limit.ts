import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Rate limit bucket tracking requests per key.
 */
interface RateBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Configuration for rate limiting.
 */
export interface RateLimitConfig {
  /** Maximum requests per window. Default: 60 */
  readonly maxRequests: number;
  /** Window size in milliseconds. Default: 60_000 (1 minute) */
  readonly windowMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 60,
  windowMs: 60_000,
};

/**
 * Parse rate limit configuration from environment.
 *
 * - CODERAG_RATE_LIMIT: requests per minute (default: 60)
 * - CODERAG_RATE_WINDOW_MS: window in ms (default: 60000)
 */
export function parseRateLimitConfig(env: Record<string, string | undefined>): RateLimitConfig {
  const maxRequests = parseInt(env['CODERAG_RATE_LIMIT'] ?? '', 10);
  const windowMs = parseInt(env['CODERAG_RATE_WINDOW_MS'] ?? '', 10);

  return {
    maxRequests: Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : DEFAULT_CONFIG.maxRequests,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_CONFIG.windowMs,
  };
}

/**
 * Create a token-bucket rate limiter middleware.
 *
 * Each API key (or IP address for unauthenticated requests) gets its own bucket.
 * The bucket is refilled at the configured rate.
 *
 * When the limit is exceeded, returns 429 with a Retry-After header.
 */
export function createRateLimitMiddleware(
  config: RateLimitConfig = DEFAULT_CONFIG,
): (req: Request, res: Response, next: NextFunction) => void {
  const buckets = new Map<string, RateBucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const clientKey = getClientKey(req);
    const bucket = getOrCreateBucket(buckets, clientKey, config, now);

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / config.windowMs) * config.maxRequests;
    bucket.tokens = Math.min(config.maxRequests, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfterMs = ((1 - bucket.tokens) / config.maxRequests) * config.windowMs;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(config.maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');

      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${retryAfterSeconds} second(s).`,
        retry_after: retryAfterSeconds,
      });
      return;
    }

    // Consume a token
    bucket.tokens -= 1;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', String(config.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));

    next();
  };
}

function getClientKey(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.apiKey) {
    return `key:${authReq.apiKey.key}`;
  }
  // Fall back to IP address
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  return `ip:${ip}`;
}

function getOrCreateBucket(
  buckets: Map<string, RateBucket>,
  key: string,
  config: RateLimitConfig,
  now: number,
): RateBucket {
  const existing = buckets.get(key);
  if (existing) {
    return existing;
  }

  const bucket: RateBucket = {
    tokens: config.maxRequests,
    lastRefill: now,
  };
  buckets.set(key, bucket);
  return bucket;
}
