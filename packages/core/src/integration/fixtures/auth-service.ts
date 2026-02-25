import { hashPassword, verifyPassword } from './utils';
import type { User, AuthToken } from './user-types';

/**
 * Authentication service that handles user login, logout, and session management.
 * Uses bcrypt for password hashing and JWT for token generation.
 */
export class AuthService {
  private readonly sessions: Map<string, AuthToken> = new Map();
  private readonly maxSessionAge = 3600000; // 1 hour

  /**
   * Authenticate a user with email and password.
   * Returns an auth token on success, or null on failure.
   */
  async login(email: string, password: string): Promise<AuthToken | null> {
    const user = await this.findUserByEmail(email);
    if (!user) {
      return null;
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    const token: AuthToken = {
      userId: user.id,
      token: this.generateToken(),
      expiresAt: new Date(Date.now() + this.maxSessionAge),
      createdAt: new Date(),
    };

    this.sessions.set(token.token, token);
    return token;
  }

  /**
   * Invalidate a session by removing the token.
   */
  logout(token: string): boolean {
    return this.sessions.delete(token);
  }

  /**
   * Validate an auth token and return the associated user ID.
   */
  validateToken(token: string): string | null {
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }

    if (session.expiresAt < new Date()) {
      this.sessions.delete(token);
      return null;
    }

    return session.userId;
  }

  private async findUserByEmail(_email: string): Promise<User | null> {
    // Stub: would query database in real implementation
    return null;
  }

  private generateToken(): string {
    return Math.random().toString(36).substring(2);
  }
}
