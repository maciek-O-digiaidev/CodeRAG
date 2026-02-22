import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { SAMLProvider } from './saml-provider.js';
import { AuthError } from './types.js';
import type { SAMLConfig } from './types.js';

// ---------------------------------------------------------------------------
// RSA key pair for SAML signature testing
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

// For test purposes, extract the base64 public key as a stand-in certificate
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
const certBase64 = publicKeyDer.toString('base64');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig(): SAMLConfig {
  return {
    idpMetadataUrl: 'https://idp.example.com/metadata',
    spEntityId: 'https://coderag.example.com',
    spAcsUrl: 'https://coderag.example.com/sso/acs',
    certificatePem: `-----BEGIN CERTIFICATE-----\n${certBase64}\n-----END CERTIFICATE-----`,
    roleMapping: {
      'coderag-admins': 'admin',
      'coderag-devs': 'developer',
      'coderag-readers': 'viewer',
    },
  };
}

function createIdpMetadataXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="https://idp.example.com">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${certBase64}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:SingleSignOnService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="https://idp.example.com/sso" />
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
}

function createSamlResponse(options?: {
  nameId?: string;
  email?: string;
  role?: string;
  notBefore?: string;
  notOnOrAfter?: string;
  audience?: string;
}): string {
  const nameId = options?.nameId ?? 'user@example.com';
  const email = options?.email ?? 'user@example.com';
  const role = options?.role ?? 'developer';
  const audience = options?.audience ?? 'https://coderag.example.com';
  const now = new Date();
  const notBefore = options?.notBefore ?? new Date(now.getTime() - 60000).toISOString();
  const notOnOrAfter = options?.notOnOrAfter ?? new Date(now.getTime() + 3600000).toISOString();

  // Create a simplified SAML assertion for testing
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <saml:Issuer>https://idp.example.com</saml:Issuer>
  <saml:Subject>
    <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID>
  </saml:Subject>
  <saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">
    <saml:AudienceRestriction>
      <saml:Audience>${audience}</saml:Audience>
    </saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AttributeStatement>
    <saml:Attribute Name="email">
      <saml:AttributeValue>${email}</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="role">
      <saml:AttributeValue>${role}</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="displayName">
      <saml:AttributeValue>Test User</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>
</saml:Assertion>`;

  // Create SignedInfo and sign it.
  // The provider extracts text between <ds:SignedInfo>...</ds:SignedInfo>,
  // trims it, and wraps it: <SignedInfo xmlns="...">{trimmed}</SignedInfo>.
  // We must sign exactly that reconstructed string.
  const digestValue = Buffer.from('test-digest').toString('base64');
  const signedInfoInner = `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI=""><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digestValue}</ds:DigestValue></ds:Reference>`;

  // This is what the provider will reconstruct and verify against
  const signedInfoXml = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoInner}</SignedInfo>`;

  const signer = createSign('RSA-SHA256');
  signer.update(signedInfoXml);
  const signatureValue = signer.sign(privateKey).toString('base64');

  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
  ${assertion}
  <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
    <ds:SignedInfo>${signedInfoInner}</ds:SignedInfo>
    <ds:SignatureValue>${signatureValue}</ds:SignatureValue>
  </ds:Signature>
</samlp:Response>`;
}

function createMockFetch(
  responses: Record<string, { ok: boolean; status: number; body: string }>,
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
      json: async () => JSON.parse(response.body),
      text: async () => response.body,
    } as Response;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SAMLProvider', () => {
  let config: SAMLConfig;

  beforeEach(() => {
    config = defaultConfig();
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('should have name set to saml', () => {
      const provider = new SAMLProvider(config);
      expect(provider.name).toBe('saml');
    });
  });

  // -----------------------------------------------------------------------
  // initialize
  // -----------------------------------------------------------------------

  describe('initialize', () => {
    it('should fetch and parse IdP metadata', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/metadata': {
          ok: true,
          status: 200,
          body: createIdpMetadataXml(),
        },
      });

      const provider = new SAMLProvider(config, mockFetch);
      const result = await provider.initialize();
      expect(result.isOk()).toBe(true);
    });

    it('should return error when metadata fetch fails', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/metadata': {
          ok: false,
          status: 500,
          body: '',
        },
      });

      const provider = new SAMLProvider(config, mockFetch);
      const result = await provider.initialize();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(AuthError);
        expect(result.error.message).toContain('metadata fetch failed');
      }
    });

    it('should return error when metadata is missing required fields', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/metadata': {
          ok: true,
          status: 200,
          body: '<EntityDescriptor></EntityDescriptor>',
        },
      });

      const provider = new SAMLProvider(config, mockFetch);
      const result = await provider.initialize();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('missing required fields');
      }
    });

    it('should return error on network failure', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('DNS resolution failed');
      }) as unknown as typeof fetch;

      const provider = new SAMLProvider(config, mockFetch);
      const result = await provider.initialize();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('DNS resolution failed');
      }
    });
  });

  // -----------------------------------------------------------------------
  // generateAuthRequest
  // -----------------------------------------------------------------------

  describe('generateAuthRequest', () => {
    it('should generate a valid SAML AuthnRequest URL', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/metadata': {
          ok: true,
          status: 200,
          body: createIdpMetadataXml(),
        },
      });

      const provider = new SAMLProvider(config, mockFetch);
      await provider.initialize();

      const result = provider.generateAuthRequest();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.url).toContain('https://idp.example.com/sso');
        expect(result.value.url).toContain('SAMLRequest=');
        expect(result.value.id).toContain('_coderag_');
      }
    });

    it('should generate unique IDs for each request', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/metadata': {
          ok: true,
          status: 200,
          body: createIdpMetadataXml(),
        },
      });

      const provider = new SAMLProvider(config, mockFetch);
      await provider.initialize();

      const result1 = provider.generateAuthRequest();
      const result2 = provider.generateAuthRequest();

      expect(result1.isOk() && result2.isOk()).toBe(true);
      if (result1.isOk() && result2.isOk()) {
        expect(result1.value.id).not.toBe(result2.value.id);
      }
    });

    it('should return error when not initialized', () => {
      const provider = new SAMLProvider(config);
      const result = provider.generateAuthRequest();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not initialized');
      }
    });
  });

  // -----------------------------------------------------------------------
  // validateResponse
  // -----------------------------------------------------------------------

  describe('validateResponse', () => {
    async function createInitializedProvider(): Promise<SAMLProvider> {
      const mockFetch = createMockFetch({
        'https://idp.example.com/metadata': {
          ok: true,
          status: 200,
          body: createIdpMetadataXml(),
        },
      });
      const provider = new SAMLProvider(config, mockFetch);
      await provider.initialize();
      return provider;
    }

    it('should validate a well-formed SAML response', async () => {
      const provider = await createInitializedProvider();
      const samlXml = createSamlResponse();
      const samlB64 = Buffer.from(samlXml).toString('base64');

      const result = await provider.validateResponse(samlB64);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.email).toBe('user@example.com');
        expect(result.value.name).toBe('Test User');
        expect(result.value.roles).toContain('developer');
      }
    });

    it('should reject an expired SAML assertion', async () => {
      const provider = await createInitializedProvider();
      const pastDate = new Date(Date.now() - 7200000).toISOString();
      const samlXml = createSamlResponse({
        notBefore: new Date(Date.now() - 14400000).toISOString(),
        notOnOrAfter: pastDate,
      });
      const samlB64 = Buffer.from(samlXml).toString('base64');

      const result = await provider.validateResponse(samlB64);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('expired');
      }
    });

    it('should reject a SAML assertion not yet valid', async () => {
      const provider = await createInitializedProvider();
      const futureDate = new Date(Date.now() + 7200000).toISOString();
      const farFuture = new Date(Date.now() + 14400000).toISOString();
      const samlXml = createSamlResponse({
        notBefore: futureDate,
        notOnOrAfter: farFuture,
      });
      const samlB64 = Buffer.from(samlXml).toString('base64');

      const result = await provider.validateResponse(samlB64);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not yet valid');
      }
    });

    it('should reject a SAML assertion with wrong audience', async () => {
      const provider = await createInitializedProvider();
      const samlXml = createSamlResponse({
        audience: 'https://wrong-audience.com',
      });
      const samlB64 = Buffer.from(samlXml).toString('base64');

      const result = await provider.validateResponse(samlB64);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('audience mismatch');
      }
    });

    it('should reject invalid Base64 input', async () => {
      const provider = await createInitializedProvider();
      // Provide valid base64 that decodes to non-XML
      const result = await provider.validateResponse(Buffer.from('not-xml-at-all').toString('base64'));
      expect(result.isErr()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // authenticate
  // -----------------------------------------------------------------------

  describe('authenticate', () => {
    it('should return AuthToken for valid SAML response', async () => {
      const mockFetch = createMockFetch({
        'https://idp.example.com/metadata': {
          ok: true,
          status: 200,
          body: createIdpMetadataXml(),
        },
      });
      const provider = new SAMLProvider(config, mockFetch);
      await provider.initialize();

      const samlXml = createSamlResponse();
      const samlB64 = Buffer.from(samlXml).toString('base64');
      const result = await provider.authenticate(samlB64);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.email).toBe('user@example.com');
        expect(result.value.roles).toContain('developer');
        expect(result.value.exp).toBeGreaterThan(result.value.iat);
      }
    });
  });

  // -----------------------------------------------------------------------
  // mapAttributes
  // -----------------------------------------------------------------------

  describe('mapAttributes', () => {
    it('should map standard email attribute', () => {
      const provider = new SAMLProvider(config);
      const user = provider.mapAttributes({
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'admin',
      });

      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
      expect(user.roles).toContain('admin');
    });

    it('should map Microsoft claims-style attributes', () => {
      const provider = new SAMLProvider(config);
      const user = provider.mapAttributes({
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'ms@example.com',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'MS User',
        'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'coderag-admins',
      });

      expect(user.email).toBe('ms@example.com');
      expect(user.name).toBe('MS User');
      expect(user.roles).toContain('admin');
    });

    it('should default to viewer when no role matches', () => {
      const provider = new SAMLProvider(config);
      const user = provider.mapAttributes({
        email: 'test@example.com',
      });

      expect(user.roles).toEqual(['viewer']);
    });

    it('should use email as fallback for name', () => {
      const provider = new SAMLProvider(config);
      const user = provider.mapAttributes({
        email: 'test@example.com',
      });

      expect(user.name).toBe('test@example.com');
    });

    it('should extract NameID from XML as user id', () => {
      const provider = new SAMLProvider(config);
      const xml = '<saml:NameID>unique-id-123</saml:NameID>';
      const user = provider.mapAttributes(
        { email: 'test@example.com' },
        xml,
      );

      expect(user.id).toBe('unique-id-123');
    });

    it('should use email as fallback for id when no NameID', () => {
      const provider = new SAMLProvider(config);
      const user = provider.mapAttributes({
        email: 'fallback@example.com',
      });

      expect(user.id).toBe('fallback@example.com');
    });
  });

  // -----------------------------------------------------------------------
  // getUserRoles / getUserRepos (cache)
  // -----------------------------------------------------------------------

  describe('getUserRoles', () => {
    it('should return viewer for unknown user', async () => {
      const provider = new SAMLProvider(config);
      const result = await provider.getUserRoles('unknown');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(['viewer']);
      }
    });
  });

  describe('getUserRepos', () => {
    it('should return empty array for unknown user', async () => {
      const provider = new SAMLProvider(config);
      const result = await provider.getUserRepos('unknown');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });
});
