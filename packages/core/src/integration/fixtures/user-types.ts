/**
 * Represents a registered user in the system.
 */
export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly createdAt: Date;
}

/**
 * Available user roles for authorization.
 */
export type UserRole = 'admin' | 'editor' | 'viewer';

/**
 * Authentication token issued after successful login.
 */
export interface AuthToken {
  readonly userId: string;
  readonly token: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * Request payload for creating a new user account.
 */
export interface CreateUserRequest {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly role?: UserRole;
}

/**
 * Response payload after user creation.
 */
export interface CreateUserResponse {
  readonly user: Omit<User, 'passwordHash'>;
  readonly token: AuthToken;
}
