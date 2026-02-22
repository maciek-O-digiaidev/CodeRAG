import { ok, err, type Result } from 'neverthrow';
import { createVerify } from 'node:crypto';
import type {
  AuthProvider,
  AuthToken,
  OIDCConfig,
  OIDCDiscoveryDocument,
  Role,
  User,
} from './types.js';
import { AuthError } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a Base64-URL string (no padding) to a standard Base64 string. */
function base64UrlToBase64(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  return base64;
}

/** Decode a Base64-URL string to a Buffer. */
function base64UrlToBuffer(input: string): Buffer {
  return Buffer.from(base64UrlToBase64(input), 'base64');
}

/** Parse a JSON string safely, returning `undefined` on failure. */
function safeJsonParse(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// JWKS types (minimal)
// ---------------------------------------------------------------------------

interface JWK {
  readonly kty: string;
  readonly kid?: string;
  readonly use?: string;
  readonly n?: string; // RSA modulus (Base64-URL)
  readonly e?: string; // RSA exponent (Base64-URL)
  readonly x5c?: readonly string[]; // Certificate chain (Base64)
}

interface JWKS {
  readonly keys: readonly JWK[];
}

// ---------------------------------------------------------------------------
// OIDCProvider
// ---------------------------------------------------------------------------

/**
 * OIDC-based `AuthProvider` that validates JWT access/id-tokens using the
 * provider's published JWKS.
 *
 * Supports Azure AD, Okta, Google Workspace and any standards-compliant
 * OpenID Connect provider.
 */
export class OIDCProvider implements AuthProvider {
  readonly name = 'oidc';

  private readonly config: OIDCConfig;
  private discovery: OIDCDiscoveryDocument | undefined;
  private jwks: JWKS | undefined;

  /** Users whose info has been fetched (in-memory cache). */
  private readonly userCache = new Map<string, User>();

  /**
   * Pluggable `fetch` function — defaults to the global `fetch`.  Tests can
   * inject a stub without monkey-patching globals.
   */
  private readonly fetchFn: typeof fetch;

  constructor(config: OIDCConfig, fetchFn?: typeof fetch) {
    this.config = config;
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Discovers OIDC endpoints from `.well-known/openid-configuration` and
   * fetches the JWKS.
   */
  async initialize(): Promise<Result<void, AuthError>> {
    const discoveryUrl = `${this.config.issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;

    try {
      const discResponse = await this.fetchFn(discoveryUrl);
      if (!discResponse.ok) {
        return err(
          new AuthError(`OIDC discovery failed: HTTP ${String(discResponse.status)}`),
        );
      }
      this.discovery = (await discResponse.json()) as OIDCDiscoveryDocument;

      const jwksResponse = await this.fetchFn(this.discovery.jwks_uri);
      if (!jwksResponse.ok) {
        return err(
          new AuthError(`JWKS fetch failed: HTTP ${String(jwksResponse.status)}`),
        );
      }
      this.jwks = (await jwksResponse.json()) as JWKS;

      return ok(undefined);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unknown error';
      return err(new AuthError(`OIDC initialization error: ${message}`));
    }
  }

  // -----------------------------------------------------------------------
  // AuthProvider implementation
  // -----------------------------------------------------------------------

  async authenticate(token: string): Promise<Result<AuthToken, AuthError>> {
    return this.validateToken(token);
  }

  async getUserRoles(userId: string): Promise<Result<readonly Role[], AuthError>> {
    const user = this.userCache.get(userId);
    if (user) {
      return ok(user.roles);
    }
    return ok(['viewer'] as const);
  }

  async getUserRepos(userId: string): Promise<Result<readonly string[], AuthError>> {
    const user = this.userCache.get(userId);
    if (user) {
      return ok(user.allowedRepos);
    }
    return ok([]);
  }

  // -----------------------------------------------------------------------
  // Token validation
  // -----------------------------------------------------------------------

  /**
   * Validates a JWT (signature, expiry, audience, issuer) and returns the
   * decoded `AuthToken`.
   */
  async validateToken(token: string): Promise<Result<AuthToken, AuthError>> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return err(new AuthError('Invalid JWT: expected 3 parts'));
    }

    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    // Decode header
    const headerJson = base64UrlToBuffer(headerB64).toString('utf-8');
    const header = safeJsonParse(headerJson);
    if (!header) {
      return err(new AuthError('Invalid JWT: malformed header'));
    }

    // Decode payload
    const payloadJson = base64UrlToBuffer(payloadB64).toString('utf-8');
    const payload = safeJsonParse(payloadJson);
    if (!payload) {
      return err(new AuthError('Invalid JWT: malformed payload'));
    }

    // Verify signature
    const sigResult = this.verifySignature(
      `${headerB64}.${payloadB64}`,
      signatureB64,
      header,
    );
    if (sigResult.isErr()) {
      return err(sigResult.error);
    }

    // Validate claims
    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload['exp'] === 'number' ? payload['exp'] : 0;
    const iat = typeof payload['iat'] === 'number' ? payload['iat'] : 0;

    if (exp <= now) {
      return err(new AuthError('Token expired'));
    }

    const issuer = typeof payload['iss'] === 'string' ? payload['iss'] : '';
    const expectedIssuer = this.discovery?.issuer ?? this.config.issuerUrl;
    if (issuer !== expectedIssuer) {
      return err(new AuthError(`Invalid issuer: expected ${expectedIssuer}, got ${issuer}`));
    }

    const audience = payload['aud'];
    const audienceList = Array.isArray(audience) ? audience : [audience];
    if (!audienceList.includes(this.config.audience)) {
      return err(
        new AuthError(
          `Invalid audience: expected ${this.config.audience}`,
        ),
      );
    }

    const sub = typeof payload['sub'] === 'string' ? payload['sub'] : '';
    const email = typeof payload['email'] === 'string' ? payload['email'] : '';
    const roles = this.mapRoles(payload);

    const authToken: AuthToken = { userId: sub, email, roles, exp, iat };
    return ok(authToken);
  }

  // -----------------------------------------------------------------------
  // User info
  // -----------------------------------------------------------------------

  /**
   * Fetches user info from the OIDC userinfo endpoint and caches it.
   */
  async getUserInfo(token: string): Promise<Result<User, AuthError>> {
    if (!this.discovery) {
      return err(new AuthError('OIDC not initialized — call initialize() first'));
    }

    try {
      const response = await this.fetchFn(this.discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        return err(new AuthError(`Userinfo request failed: HTTP ${String(response.status)}`));
      }

      const info = (await response.json()) as Record<string, unknown>;
      const sub = typeof info['sub'] === 'string' ? info['sub'] : '';
      const email = typeof info['email'] === 'string' ? info['email'] : '';
      const name = typeof info['name'] === 'string' ? info['name'] : email;
      const roles = this.mapRoles(info);

      const user: User = {
        id: sub,
        email,
        name,
        roles,
        allowedRepos: [],
      };

      this.userCache.set(sub, user);
      return ok(user);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown error';
      return err(new AuthError(`Userinfo error: ${message}`));
    }
  }

  // -----------------------------------------------------------------------
  // Role mapping
  // -----------------------------------------------------------------------

  /**
   * Maps OIDC claims / groups to CodeRAG roles.
   *
   * Checks `roles`, `groups` and `realm_access.roles` claims (covers Azure
   * AD, Okta, Keycloak).  Falls back to `viewer` if no mapping matches.
   */
  mapRoles(claims: Readonly<Record<string, unknown>>): readonly Role[] {
    const mapping = this.config.roleMapping ?? {};
    const claimValues = new Set<string>();

    // Collect candidate values from well-known claim names
    for (const claimName of ['roles', 'groups']) {
      const value = claims[claimName];
      if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === 'string') claimValues.add(v);
        }
      }
      if (typeof value === 'string') claimValues.add(value);
    }

    // Keycloak: realm_access.roles
    const realmAccess = claims['realm_access'];
    if (realmAccess && typeof realmAccess === 'object' && !Array.isArray(realmAccess)) {
      const ra = realmAccess as Record<string, unknown>;
      const raRoles = ra['roles'];
      if (Array.isArray(raRoles)) {
        for (const v of raRoles) {
          if (typeof v === 'string') claimValues.add(v);
        }
      }
    }

    const roles = new Set<Role>();
    for (const value of claimValues) {
      const mapped = mapping[value];
      if (mapped) {
        roles.add(mapped);
      }
      // Also accept direct role names
      if (value === 'admin' || value === 'developer' || value === 'viewer') {
        roles.add(value);
      }
    }

    if (roles.size === 0) {
      return ['viewer'];
    }
    return [...roles];
  }

  // -----------------------------------------------------------------------
  // Signature verification
  // -----------------------------------------------------------------------

  private verifySignature(
    data: string,
    signatureB64Url: string,
    header: Readonly<Record<string, unknown>>,
  ): Result<void, AuthError> {
    if (!this.jwks) {
      return err(new AuthError('JWKS not loaded — call initialize() first'));
    }

    const alg = typeof header['alg'] === 'string' ? header['alg'] : '';
    const kid = typeof header['kid'] === 'string' ? header['kid'] : undefined;

    // Find matching key
    let jwk: JWK | undefined;
    if (kid) {
      jwk = this.jwks.keys.find((k) => k.kid === kid);
    }
    if (!jwk) {
      // Fallback: first sig key
      jwk = this.jwks.keys.find(
        (k) => k.use === 'sig' || k.use === undefined,
      );
    }
    if (!jwk) {
      return err(new AuthError('No suitable JWK found for token verification'));
    }

    // For RS256 with x5c certificate chain
    if (alg === 'RS256' && jwk.x5c && jwk.x5c.length > 0) {
      const cert = jwk.x5c[0];
      if (!cert) {
        return err(new AuthError('Empty x5c certificate chain'));
      }
      const pem = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
      const signature = base64UrlToBuffer(signatureB64Url);

      const verifier = createVerify('RSA-SHA256');
      verifier.update(data);
      const valid = verifier.verify(pem, signature);
      if (!valid) {
        return err(new AuthError('Invalid JWT signature'));
      }
      return ok(undefined);
    }

    // For RS256 with n/e (modulus/exponent)
    if (alg === 'RS256' && jwk.n && jwk.e) {
      const modulus = base64UrlToBuffer(jwk.n);
      const exponent = base64UrlToBuffer(jwk.e);
      const pem = rsaJwkToPem(modulus, exponent);
      const signature = base64UrlToBuffer(signatureB64Url);

      const verifier = createVerify('RSA-SHA256');
      verifier.update(data);
      const valid = verifier.verify(pem, signature);
      if (!valid) {
        return err(new AuthError('Invalid JWT signature'));
      }
      return ok(undefined);
    }

    return err(new AuthError(`Unsupported JWT algorithm or key type: ${alg}`));
  }
}

// ---------------------------------------------------------------------------
// RSA JWK → PEM conversion (DER encoding)
// ---------------------------------------------------------------------------

/**
 * Converts RSA modulus + exponent to a PEM-encoded public key.
 *
 * This performs minimal ASN.1 DER encoding required for
 * `crypto.createVerify` to consume the key.
 */
function rsaJwkToPem(modulus: Buffer, exponent: Buffer): string {
  // Ensure positive integers (prepend 0x00 if high bit set)
  const mod = modulus[0]! >= 0x80 ? Buffer.concat([Buffer.from([0x00]), modulus]) : modulus;
  const exp = exponent[0]! >= 0x80 ? Buffer.concat([Buffer.from([0x00]), exponent]) : exponent;

  const modLen = derLength(mod.length);
  const expLen = derLength(exp.length);

  // SEQUENCE { INTEGER modulus, INTEGER exponent }
  const rsaPubKeyBody = Buffer.concat([
    Buffer.from([0x02]), modLen, mod,
    Buffer.from([0x02]), expLen, exp,
  ]);
  const rsaPubKeySeq = Buffer.concat([
    Buffer.from([0x30]), derLength(rsaPubKeyBody.length), rsaPubKeyBody,
  ]);

  // BIT STRING wrapping
  const bitString = Buffer.concat([
    Buffer.from([0x03]),
    derLength(rsaPubKeySeq.length + 1),
    Buffer.from([0x00]), // unused bits
    rsaPubKeySeq,
  ]);

  // Algorithm identifier for rsaEncryption (OID 1.2.840.113549.1.1.1)
  const algorithmIdentifier = Buffer.from([
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ]);

  // Outer SEQUENCE { AlgorithmIdentifier, BIT STRING }
  const outer = Buffer.concat([
    Buffer.from([0x30]),
    derLength(algorithmIdentifier.length + bitString.length),
    algorithmIdentifier,
    bitString,
  ]);

  const b64 = outer.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/** DER length encoding. */
function derLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  if (len < 0x100) {
    return Buffer.from([0x81, len]);
  }
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}
