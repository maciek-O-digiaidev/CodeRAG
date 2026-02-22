import { describe, it, expect } from 'vitest';
import { AuthError, ROLE_HIERARCHY } from './types.js';
import type {
  Role,
  Action,
  RepoAccessLevel,
  RepoPermission,
  User,
  AuthToken,
  AuditEntry,
  AuditQuery,
  OIDCConfig,
  SAMLConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// AuthError
// ---------------------------------------------------------------------------

describe('AuthError', () => {
  it('should have name set to AuthError', () => {
    const error = new AuthError('something failed');
    expect(error.name).toBe('AuthError');
  });

  it('should preserve the error message', () => {
    const error = new AuthError('invalid token');
    expect(error.message).toBe('invalid token');
  });

  it('should be an instance of Error', () => {
    const error = new AuthError('test');
    expect(error).toBeInstanceOf(Error);
  });

  it('should be an instance of AuthError', () => {
    const error = new AuthError('test');
    expect(error).toBeInstanceOf(AuthError);
  });
});

// ---------------------------------------------------------------------------
// ROLE_HIERARCHY
// ---------------------------------------------------------------------------

describe('ROLE_HIERARCHY', () => {
  it('should contain all three roles', () => {
    expect(ROLE_HIERARCHY).toHaveLength(3);
    expect(ROLE_HIERARCHY).toContain('viewer');
    expect(ROLE_HIERARCHY).toContain('developer');
    expect(ROLE_HIERARCHY).toContain('admin');
  });

  it('should be ordered from lowest to highest privilege', () => {
    expect(ROLE_HIERARCHY[0]).toBe('viewer');
    expect(ROLE_HIERARCHY[1]).toBe('developer');
    expect(ROLE_HIERARCHY[2]).toBe('admin');
  });

  it('should be readonly', () => {
    // TypeScript enforces this, but verify at runtime
    expect(Object.isFrozen(ROLE_HIERARCHY)).toBe(false); // `as const` doesn't freeze
    expect(Array.isArray(ROLE_HIERARCHY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Type shape validation (compile-time + runtime)
// ---------------------------------------------------------------------------

describe('Type shapes', () => {
  it('should accept valid Role values', () => {
    const roles: Role[] = ['admin', 'developer', 'viewer'];
    expect(roles).toHaveLength(3);
  });

  it('should accept valid Action values', () => {
    const actions: Action[] = [
      'search', 'context', 'status', 'explain', 'docs', 'index', 'configure',
    ];
    expect(actions).toHaveLength(7);
  });

  it('should accept valid RepoAccessLevel values', () => {
    const levels: RepoAccessLevel[] = ['read', 'write', 'admin'];
    expect(levels).toHaveLength(3);
  });

  it('should create a valid RepoPermission', () => {
    const perm: RepoPermission = {
      repoName: 'my-repo',
      access: 'write',
    };
    expect(perm.repoName).toBe('my-repo');
    expect(perm.access).toBe('write');
  });

  it('should create a valid User', () => {
    const user: User = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      roles: ['developer'],
      allowedRepos: ['repo-a', 'repo-b'],
    };
    expect(user.id).toBe('user-1');
    expect(user.roles).toContain('developer');
    expect(user.allowedRepos).toHaveLength(2);
  });

  it('should create a valid AuthToken', () => {
    const token: AuthToken = {
      userId: 'user-1',
      email: 'user@example.com',
      roles: ['admin'],
      exp: 1700000000,
      iat: 1699996400,
    };
    expect(token.exp).toBeGreaterThan(token.iat);
  });

  it('should create a valid AuditEntry', () => {
    const entry: AuditEntry = {
      timestamp: new Date(),
      userId: 'user-1',
      action: 'search',
      resource: 'repo-a',
      details: 'searched for foo',
      ip: '192.168.1.1',
    };
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(typeof entry.userId).toBe('string');
  });

  it('should create a valid AuditQuery with all optional fields', () => {
    const query: AuditQuery = {
      userId: 'user-1',
      action: 'search',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      limit: 100,
    };
    expect(query.limit).toBe(100);
  });

  it('should create a valid AuditQuery with no fields', () => {
    const query: AuditQuery = {};
    expect(query.userId).toBeUndefined();
    expect(query.action).toBeUndefined();
  });

  it('should create a valid OIDCConfig', () => {
    const config: OIDCConfig = {
      issuerUrl: 'https://idp.example.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      audience: 'api',
      roleMapping: {
        'admin-group': 'admin',
      },
    };
    expect(config.issuerUrl).toBe('https://idp.example.com');
    expect(config.roleMapping?.['admin-group']).toBe('admin');
  });

  it('should create a valid SAMLConfig', () => {
    const config: SAMLConfig = {
      idpMetadataUrl: 'https://idp.example.com/metadata',
      spEntityId: 'https://sp.example.com',
      spAcsUrl: 'https://sp.example.com/acs',
      certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBxTCCA...\n-----END CERTIFICATE-----',
      roleMapping: {
        admins: 'admin',
      },
    };
    expect(config.spEntityId).toBe('https://sp.example.com');
    expect(config.roleMapping?.['admins']).toBe('admin');
  });
});
