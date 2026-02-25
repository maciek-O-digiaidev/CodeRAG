/**
 * Validate an email address format.
 */
export function isValidEmail(email: string): boolean {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
}

/**
 * Validate password strength requirements.
 * Must be at least 8 characters with uppercase, lowercase, and digit.
 */
export function isStrongPassword(password: string): boolean {
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/\d/.test(password)) return false;
  return true;
}

/**
 * Sanitize a string by removing HTML tags and trimming whitespace.
 */
export function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * Validate that a value is a non-empty string.
 */
export function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate a pagination offset and limit.
 */
export interface PaginationParams {
  readonly offset: number;
  readonly limit: number;
}

export function validatePagination(
  offset: unknown,
  limit: unknown,
): PaginationParams | null {
  const parsedOffset = typeof offset === 'number' ? offset : Number(offset);
  const parsedLimit = typeof limit === 'number' ? limit : Number(limit);

  if (isNaN(parsedOffset) || isNaN(parsedLimit)) return null;
  if (parsedOffset < 0 || parsedLimit < 1 || parsedLimit > 100) return null;

  return { offset: parsedOffset, limit: parsedLimit };
}
