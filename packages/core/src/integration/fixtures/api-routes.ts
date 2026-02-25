import type { User, CreateUserRequest, CreateUserResponse } from './user-types';
import { AuthService } from './auth-service';
import { generateId } from './utils';
import { DEFAULT_PORT, RATE_LIMIT_CONFIG } from './config';

/**
 * API route handler for user registration.
 */
export async function handleCreateUser(
  request: CreateUserRequest,
): Promise<CreateUserResponse> {
  const authService = new AuthService();
  const userId = generateId();

  const user: Omit<User, 'passwordHash'> = {
    id: userId,
    email: request.email,
    name: request.name,
    role: request.role ?? 'viewer',
    createdAt: new Date(),
  };

  const token = await authService.login(request.email, request.password);

  return {
    user,
    token: token ?? {
      userId,
      token: '',
      expiresAt: new Date(),
      createdAt: new Date(),
    },
  };
}

/**
 * API route handler for health check endpoint.
 */
export function handleHealthCheck(): { status: string; port: number; rateLimit: number } {
  return {
    status: 'healthy',
    port: DEFAULT_PORT,
    rateLimit: RATE_LIMIT_CONFIG.maxRequests,
  };
}

/**
 * Middleware to validate request authentication headers.
 */
export function validateAuthHeader(
  authHeader: string | undefined,
): { valid: boolean; userId?: string } {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false };
  }

  const token = authHeader.slice(7);
  if (token.length === 0) {
    return { valid: false };
  }

  // In a real app, validate the token against the auth service
  return { valid: true, userId: 'mock-user-id' };
}
