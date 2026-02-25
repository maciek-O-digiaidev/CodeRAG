/**
 * Runtime type-checking utilities to replace unsafe `as` type assertions.
 *
 * Each function validates the runtime type of an unknown value and returns
 * a properly typed result, using a fallback when provided or throwing
 * a descriptive TypeError when the value does not match.
 */

/**
 * Safely extract a string from an unknown value.
 * Returns the value if it is a string, the fallback if provided, or throws.
 */
export function safeString(value: unknown, fallback?: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new TypeError(`Expected string, got ${typeof value}`);
}

/**
 * Safely extract a number from an unknown value.
 * Returns the value if it is a finite number, the fallback if provided, or throws.
 */
export function safeNumber(value: unknown, fallback?: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new TypeError(`Expected number, got ${typeof value}`);
}

/**
 * Safely extract a Record<string, unknown> from an unknown value.
 * Returns the value if it is a non-null, non-array object, the fallback if provided, or throws.
 */
export function safeRecord(
  value: unknown,
  fallback?: Record<string, unknown>,
): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Runtime guard validates non-null, non-array object
    return value as Record<string, unknown>;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new TypeError(`Expected record (object), got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`);
}

/**
 * Safely extract an array from an unknown value.
 * Returns the value if it is an array, the fallback if provided, or throws.
 */
export function safeArray(value: unknown, fallback?: unknown[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new TypeError(`Expected array, got ${typeof value}`);
}

/**
 * Safely extract a string that must be one of the allowed values (union type guard).
 * Returns the value if it matches, the fallback if provided, or throws.
 */
export function safeStringUnion<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback?: T,
): T {
  if (typeof value === 'string') {
    const matched = allowed.find((item) => item === value);
    if (matched !== undefined) {
      return matched;
    }
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new TypeError(
    `Expected one of [${allowed.join(', ')}], got ${typeof value === 'string' ? `"${value}"` : typeof value}`,
  );
}
