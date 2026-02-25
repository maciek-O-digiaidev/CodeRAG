/**
 * Application configuration constants.
 */

export const APP_NAME = 'TestApp';
export const APP_VERSION = '1.0.0';

export const DEFAULT_PORT = 3000;
export const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB

export const SESSION_CONFIG = {
  maxAge: 3600000,
  secure: true,
  httpOnly: true,
  sameSite: 'strict' as const,
} as const;

export const RATE_LIMIT_CONFIG = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  message: 'Too many requests, please try again later.',
} as const;

export const DATABASE_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'testapp',
  poolSize: 10,
  idleTimeoutMs: 30000,
} as const;

export const CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
] as const;
