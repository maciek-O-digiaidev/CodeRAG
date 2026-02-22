import type { Result } from 'neverthrow';

// ---------------------------------------------------------------------------
// Roles & Permissions
// ---------------------------------------------------------------------------

/** CodeRAG role hierarchy: Admin > Developer > Viewer */
export type Role = 'admin' | 'developer' | 'viewer';

/** Ordered role hierarchy (index = privilege level, higher = more access). */
export const ROLE_HIERARCHY: readonly Role[] = ['viewer', 'developer', 'admin'] as const;

/** Actions that can be gated by RBAC. */
export type Action =
  | 'search'
  | 'context'
  | 'status'
  | 'explain'
  | 'docs'
  | 'index'
  | 'configure';

/** Per-repo access level. */
export type RepoAccessLevel = 'read' | 'write' | 'admin';

export interface RepoPermission {
  readonly repoName: string;
  readonly access: RepoAccessLevel;
}

// ---------------------------------------------------------------------------
// User & Token
// ---------------------------------------------------------------------------

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly Role[];
  readonly allowedRepos: readonly string[];
}

export interface AuthToken {
  readonly userId: string;
  readonly email: string;
  readonly roles: readonly Role[];
  readonly exp: number;
  readonly iat: number;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  readonly timestamp: Date;
  readonly userId: string;
  readonly action: string;
  readonly resource: string;
  readonly details: string;
  readonly ip: string;
}

export interface AuditQuery {
  readonly userId?: string;
  readonly action?: string;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Auth Provider interface
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthProvider {
  readonly name: string;
  authenticate(token: string): Promise<Result<AuthToken, AuthError>>;
  getUserRoles(userId: string): Promise<Result<readonly Role[], AuthError>>;
  getUserRepos(userId: string): Promise<Result<readonly string[], AuthError>>;
}

// ---------------------------------------------------------------------------
// OIDC Configuration
// ---------------------------------------------------------------------------

export interface OIDCConfig {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: string;
  /** Optional mapping from OIDC group claim values to CodeRAG roles. */
  readonly roleMapping?: Readonly<Record<string, Role>>;
}

/** Subset of the OpenID Connect Discovery document we use. */
export interface OIDCDiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint: string;
  readonly jwks_uri: string;
}

// ---------------------------------------------------------------------------
// SAML Configuration
// ---------------------------------------------------------------------------

export interface SAMLConfig {
  readonly idpMetadataUrl: string;
  readonly spEntityId: string;
  readonly spAcsUrl: string;
  readonly certificatePem: string;
  /** Optional mapping from SAML attribute values to CodeRAG roles. */
  readonly roleMapping?: Readonly<Record<string, Role>>;
}

export interface SAMLIdPMetadata {
  readonly entityId: string;
  readonly ssoUrl: string;
  readonly certificate: string;
  readonly nameIdFormat: string;
}
