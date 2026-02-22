import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { OIDCProvider } from './oidc-provider.js';
import { AuthError } from './types.js';
import type { OIDCConfig, OIDCDiscoveryDocument } from './types.js';

// ---------------------------------------------------------------------------
// RSA key pair for signing test JWTs
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

// Extract n and e from JWK format for testing
const jwkExport = publicKey.export({ format: 'jwk' }) as {
  n: string;
  e: string;
  kty: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createJwt(
  payload: Record<string, unknown>,
  options?: {
    kid?: string;
    alg?: string;
    useX5c?: boolean;
  },
): string {
  const header = {
    alg: options?.alg ?? 'RS256',
    typ: 'JWT',
    kid: options?.kid ?? 'test-key-1',
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;

  const signer = createSign('RSA-SHA256');
  signer.update(data);
  const signature = signer.sign(privateKey);
  const sigB64 = base64UrlEncode(signature);

  return `${data}.${sigB64}`;
}

function defaultConfig(): OIDCConfig {
  return {
    issuerUrl: 'https://idp.example.com',
    clientId: 'coderag-client',
    clientSecret: 'secret',
    audience: 'coderag-api',
    roleMapping: {
      'CodeRAG-Admin': 'admin',
      'CodeRAG-Dev': 'developer',
      'CodeRAG-Reader': 'viewer',
    },
  };
}

function defaultDiscovery(): OIDCDiscoveryDocument {
  return {
    issuer: 'https://idp.example.com',
    authorization_endpoint: 'https://idp.example.com/authorize',
    token_endpoint: 'https://idp.example.com/token',
    userinfo_endpoint: 'https://idp.example.com/userinfo',
    jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
  };
}

function defaultJwks(): { keys: Array<Record<string, unknown>> } {
  return {
    keys: [
      {
        kty: 'RSA',
        kid: 'test-key-1',
        use: 'sig',
        n: jwkExport.n,
        e: jwkExport.e,
      },
    ],
  };
}

function createMockFetch(
  responses: Record<string, { ok: boolean; status: number; body: unknown }>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const response = responses[url];
    if (!response) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      } as Response;
    }
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as Response;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OIDCProvider', () => {
  let config: OIDCConfig;

  beforeEach(() => {
    config = defaultConfig();
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('should have name set to oidc', () => {
      const provider = new OIDCProvider(config);
      expect(provider.name).toBe('oidc');
    });
  });

  // -----------------------------------------------------------------------
  // initialize
  // -----------------------------------------------------------------------

  describe('initialize', () => {
    it('should fetch discovery document and JWKS', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/.well-known/openid-configuration': {
          ok: true,
          status: 200,
          body: defaultDiscovery(),
        },
        'https://idp.example.com/.well-known/jwks.json': {
          ok: true,
          status: 200,
          body: defaultJwks(),
        },
      });

      const provider = new OIDCProvider(config, mockFetch);
      const result = await provider.initialize();
      expect(result.isOk()).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return error when discovery fails', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/.well-known/openid-configuration': {
          ok: false,
          status: 500,
          body: {},
        },
      });

      const provider = new OIDCProvider(config, mockFetch);
      const result = await provider.initialize();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(AuthError);
        expect(result.error.message).toContain('discovery failed');
      }
    });

    it('should return error when JWKS fetch fails', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/.well-known/openid-configuration': {
          ok: true,
          status: 200,
          body: defaultDiscovery(),
        },
        'https://idp.example.com/.well-known/jwks.json': {
          ok: false,
          status: 500,
          body: {},
        },
      });

      const provider = new OIDCProvider(config, mockFetch);
      const result = await provider.initialize();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('JWKS fetch failed');
      }
    });

    it('should return error on network failure', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Network unreachable');
      }) as unknown as typeof fetch;

      const provider = new OIDCProvider(config, mockFetch);
      const result = await provider.initialize();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Network unreachable');
      }
    });

    it('should strip trailing slash from issuer URL', async () => {
      const configWithSlash: OIDCConfig = {
        ...config,
        issuerUrl: 'https://idp.example.com/',
      };
      const mockFetch = createMockFetch({
        'https://idp.example.com/.well-known/openid-configuration': {
          ok: true,
          status: 200,
          body: defaultDiscovery(),
        },
        'https://idp.example.com/.well-known/jwks.json': {
          ok: true,
          status: 200,
          body: defaultJwks(),
        },
      });

      const provider = new OIDCProvider(configWithSlash, mockFetch);
      const result = await provider.initialize();
      expect(result.isOk()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // validateToken
  // -----------------------------------------------------------------------

  describe('validateToken', () => {
    async function createInitializedProvider(
      jwks?: { keys: Array<Record<string, unknown>> },
    ): Promise<OIDCProvider> {
      const mockFetch = createMockFetch({
        'https://idp.example.com/.well-known/openid-configuration': {
          ok: true,
          status: 200,
          body: defaultDiscovery(),
        },
        'https://idp.example.com/.well-known/jwks.json': {
          ok: true,
          status: 200,
          body: jwks ?? defaultJwks(),
        },
      });
      const provider = new OIDCProvider(config, mockFetch);
      await provider.initialize();
      return provider;
    }

    it('should validate a valid JWT with n/e JWKS key', async () => {
      const provider = await createInitializedProvider();
      const now = Math.floor(Date.now() / 1000);
      const token = createJwt({
        sub: 'user-123',
        email: 'user@example.com',
        iss: 'https://idp.example.com',
        aud: 'coderag-api',
        exp: now + 3600,
        iat: now,
      });

      const result = await provider.validateToken(token);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.userId).toBe('user-123');
        expect(result.value.email).toBe('user@example.com');
        expect(result.value.exp).toBe(now + 3600);
        expect(result.value.iat).toBe(now);
      }
    });

    it('should reject an expired token', async () => {
      const provider = await createInitializedProvider();
      const now = Math.floor(Date.now() / 1000);
      const token = createJwt({
        sub: 'user-123',
        email: 'user@example.com',
        iss: 'https://idp.example.com',
        aud: 'coderag-api',
        exp: now - 100,
        iat: now - 3700,
      });

      const result = await provider.validateToken(token);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('expired');
      }
    });

    it('should reject a token with wrong issuer', async () => {
      const provider = await createInitializedProvider();
      const now = Math.floor(Date.now() / 1000);
      const token = createJwt({
        sub: 'user-123',
        iss: 'https://evil.example.com',
        aud: 'coderag-api',
        exp: now + 3600,
        iat: now,
      });

      const result = await provider.validateToken(token);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid issuer');
      }
    });

    it('should reject a token with wrong audience', async () => {
      const provider = await createInitializedProvider();
      const now = Math.floor(Date.now() / 1000);
      const token = createJwt({
        sub: 'user-123',
        iss: 'https://idp.example.com',
        aud: 'wrong-audience',
        exp: now + 3600,
        iat: now,
      });

      const result = await provider.validateToken(token);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid audience');
      }
    });

    it('should accept a token with audience as array', async () => {
      const provider = await createInitializedProvider();
      const now = Math.floor(Date.now() / 1000);
      const token = createJwt({
        sub: 'user-123',
        iss: 'https://idp.example.com',
        aud: ['other-api', 'coderag-api'],
        exp: now + 3600,
        iat: now,
      });

      const result = await provider.validateToken(token);
      expect(result.isOk()).toBe(true);
    });

    it('should reject a malformed JWT (not 3 parts)', async () => {
      const provider = await createInitializedProvider();
      const result = await provider.validateToken('not.a.valid.jwt.token');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('expected 3 parts');
      }
    });

    it('should reject a JWT with invalid header JSON', async () => {
      const provider = await createInitializedProvider();
      const badHeader = base64UrlEncode('not-json');
      const payload = base64UrlEncode(JSON.stringify({ sub: 'test' }));
      const result = await provider.validateToken(`${badHeader}.${payload}.sig`);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('malformed header');
      }
    });

    it('should reject a JWT with invalid payload JSON', async () => {
      const provider = await createInitializedProvider();
      const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', kid: 'test-key-1' }));
      const badPayload = base64UrlEncode('not-json');
      const result = await provider.validateToken(`${header}.${badPayload}.sig`);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('malformed payload');
      }
    });
  });

  // -----------------------------------------------------------------------
  // authenticate (delegates to validateToken)
  // -----------------------------------------------------------------------

  describe('authenticate', () => {
    it('should return AuthToken for valid JWT', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/.well-known/openid-configuration': {
          ok: true,
          status: 200,
          body: defaultDiscovery(),
        },
        'https://idp.example.com/.well-known/jwks.json': {
          ok: true,
          status: 200,
          body: defaultJwks(),
        },
      });
      const provider = new OIDCProvider(config, mockFetch);
      await provider.initialize();

      const now = Math.floor(Date.now() / 1000);
      const token = createJwt({
        sub: 'u-1',
        email: 'a@b.com',
        iss: 'https://idp.example.com',
        aud: 'coderag-api',
        exp: now + 3600,
        iat: now,
        roles: ['CodeRAG-Admin'],
      });

      const result = await provider.authenticate(token);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.userId).toBe('u-1');
        expect(result.value.roles).toContain('admin');
      }
    });
  });

  // -----------------------------------------------------------------------
  // getUserInfo
  // -----------------------------------------------------------------------

  describe('getUserInfo', () => {
    it('should fetch and cache user info', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/.well-known/openid-configuration': {
          ok: true,
          status: 200,
          body: defaultDiscovery(),
        },
        'https://idp.example.com/.well-known/jwks.json': {
          ok: true,
          status: 200,
          body: defaultJwks(),
        },
        'https://idp.example.com/userinfo': {
          ok: true,
          status: 200,
          body: {
            sub: 'user-42',
            email: 'jane@example.com',
            name: 'Jane Doe',
            groups: ['CodeRAG-Dev'],
          },
        },
      });

      const provider = new OIDCProvider(config, mockFetch);
      await provider.initialize();
      const result = await provider.getUserInfo('some-access-token');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('user-42');
        expect(result.value.email).toBe('jane@example.com');
        expect(result.value.name).toBe('Jane Doe');
        expect(result.value.roles).toContain('developer');
      }

      // Verify cache works
      const rolesResult = await provider.getUserRoles('user-42');
      expect(rolesResult.isOk()).toBe(true);
      if (rolesResult.isOk()) {
        expect(rolesResult.value).toContain('developer');
      }
    });

    it('should return error when not initialized', async () => {
      const provider = new OIDCProvider(config);
      const result = await provider.getUserInfo('token');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not initialized');
      }
    });

    it('should return error on userinfo HTTP failure', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/.well-known/openid-configuration': {
          ok: true,
          status: 200,
          body: defaultDiscovery(),
        },
        'https://idp.example.com/.well-known/jwks.json': {
          ok: true,
          status: 200,
          body: defaultJwks(),
        },
        'https://idp.example.com/userinfo': {
          ok: false,
          status: 401,
          body: {},
        },
      });

      const provider = new OIDCProvider(config, mockFetch);
      await provider.initialize();
      const result = await provider.getUserInfo('bad-token');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Userinfo request failed');
      }
    });
  });

  // -----------------------------------------------------------------------
  // mapRoles
  // -----------------------------------------------------------------------

  describe('mapRoles', () => {
    it('should map OIDC group claims using roleMapping', () => {
      const provider = new OIDCProvider(config);
      const roles = provider.mapRoles({
        groups: ['CodeRAG-Admin', 'other-group'],
      });
      expect(roles).toContain('admin');
      expect(roles).not.toContain('other-group');
    });

    it('should accept direct role names (admin, developer, viewer)', () => {
      const provider = new OIDCProvider(config);
      const roles = provider.mapRoles({ roles: ['admin'] });
      expect(roles).toContain('admin');
    });

    it('should support roles as a comma-separated string', () => {
      const provider = new OIDCProvider(config);
      const roles = provider.mapRoles({ roles: 'admin' });
      expect(roles).toContain('admin');
    });

    it('should handle Keycloak realm_access.roles claim', () => {
      const provider = new OIDCProvider(config);
      const roles = provider.mapRoles({
        realm_access: { roles: ['CodeRAG-Dev'] },
      });
      expect(roles).toContain('developer');
    });

    it('should default to viewer when no mapping matches', () => {
      const provider = new OIDCProvider(config);
      const roles = provider.mapRoles({ groups: ['unrelated-group'] });
      expect(roles).toEqual(['viewer']);
    });

    it('should default to viewer when claims are empty', () => {
      const provider = new OIDCProvider(config);
      const roles = provider.mapRoles({});
      expect(roles).toEqual(['viewer']);
    });

    it('should deduplicate roles', () => {
      const provider = new OIDCProvider(config);
      const roles = provider.mapRoles({
        roles: ['admin'],
        groups: ['CodeRAG-Admin'],
      });
      // admin appears from both, should be deduplicated
      const adminCount = roles.filter((r) => r === 'admin').length;
      expect(adminCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // getUserRoles / getUserRepos (cache miss)
  // -----------------------------------------------------------------------

  describe('getUserRoles (cache miss)', () => {
    it('should return viewer for unknown user', async () => {
      const provider = new OIDCProvider(config);
      const result = await provider.getUserRoles('unknown-user');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(['viewer']);
      }
    });
  });

  describe('getUserRepos (cache miss)', () => {
    it('should return empty array for unknown user', async () => {
      const provider = new OIDCProvider(config);
      const result = await provider.getUserRepos('unknown-user');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });
});
