import { ok, err, type Result } from 'neverthrow';
import { createVerify } from 'node:crypto';
import type {
  AuthProvider,
  AuthToken,
  Role,
  SAMLConfig,
  SAMLIdPMetadata,
  User,
} from './types.js';
import { AuthError } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the text content of the first occurrence of `tagName` from XML.
 * This is a minimal, dependency-free XML "parser" — it does **not** handle
 * namespaces, CDATA, or nested elements with the same local name.  Sufficient
 * for SAML metadata / response parsing.
 */
function xmlGetText(xml: string, tagName: string): string | undefined {
  // Match both with and without namespace prefix
  const localName = tagName.includes(':') ? tagName.split(':').pop()! : tagName;

  // Try with namespace prefix first, then without
  for (const name of [tagName, localName]) {
    const esc = escapeRegex(name);
    const patterns = [
      // <ns:Tag ...>content</ns:Tag> — requires tag name to end at > or whitespace
      new RegExp(`<(?:[a-zA-Z0-9_]+:)?${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${esc}>`, 'i'),
      // <Tag ...>content</Tag>
      new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`, 'i'),
    ];

    for (const re of patterns) {
      const match = re.exec(xml);
      if (match?.[1] !== undefined) {
        return match[1].trim();
      }
    }
  }
  return undefined;
}

/**
 * Extracts an attribute value from the first element matching `tagName`.
 */
function xmlGetAttr(xml: string, tagName: string, attrName: string): string | undefined {
  const localName = tagName.includes(':') ? tagName.split(':').pop()! : tagName;

  for (const name of [tagName, localName]) {
    const esc = escapeRegex(name);
    // Match <ns:Tag ...> or <Tag ...> — tag name must be followed by whitespace, /, or >
    const tagRe = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${esc}(?:\\s[^>]*|\\/)?>`, 'i');
    const tagMatch = tagRe.exec(xml);
    if (tagMatch) {
      const attrRe = new RegExp(`${escapeRegex(attrName)}\\s*=\\s*"([^"]*)"`, 'i');
      const attrMatch = attrRe.exec(tagMatch[0]);
      if (attrMatch?.[1] !== undefined) {
        return attrMatch[1];
      }
    }
  }
  return undefined;
}

/**
 * Extracts all SAML attribute values from a SAML Response.
 * Returns a map of attribute name -> value.
 */
function extractSamlAttributes(xml: string): Record<string, string> {
  const attrs: Record<string, string> = {};

  // Match <saml:Attribute Name="..."><saml:AttributeValue>...</saml:AttributeValue></saml:Attribute>
  const attrRe = /<[^>]*?Attribute\s[^>]*?Name\s*=\s*"([^"]*)"[^>]*?>([\s\S]*?)<\/[^>]*?Attribute>/gi;
  let attrMatch = attrRe.exec(xml);
  while (attrMatch) {
    const name = attrMatch[1];
    const body = attrMatch[2];
    if (name && body) {
      // Get the first AttributeValue
      const valueRe = /<[^>]*?AttributeValue[^>]*?>([\s\S]*?)<\/[^>]*?AttributeValue>/i;
      const valueMatch = valueRe.exec(body);
      if (valueMatch?.[1] !== undefined) {
        attrs[name] = valueMatch[1].trim();
      }
    }
    attrMatch = attrRe.exec(xml);
  }

  return attrs;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// SAMLProvider
// ---------------------------------------------------------------------------

/**
 * SAML 2.0 `AuthProvider` implementation.
 *
 * Handles AuthnRequest generation and SAML Response validation for
 * enterprise SSO integration.
 */
export class SAMLProvider implements AuthProvider {
  readonly name = 'saml';

  private readonly config: SAMLConfig;
  private idpMetadata: SAMLIdPMetadata | undefined;

  /** Users whose info has been resolved (in-memory cache). */
  private readonly userCache = new Map<string, User>();

  /** Counter for unique AuthnRequest IDs. */
  private requestCounter = 0;

  /**
   * Pluggable `fetch` function — defaults to the global `fetch`.
   */
  private readonly fetchFn: typeof fetch;

  constructor(config: SAMLConfig, fetchFn?: typeof fetch) {
    this.config = config;
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Fetches and parses IdP metadata XML to discover SSO URL, certificate,
   * and NameID format.
   */
  async initialize(): Promise<Result<void, AuthError>> {
    try {
      const response = await this.fetchFn(this.config.idpMetadataUrl);
      if (!response.ok) {
        return err(
          new AuthError(`IdP metadata fetch failed: HTTP ${String(response.status)}`),
        );
      }

      const xml = await response.text();
      const entityId = xmlGetAttr(xml, 'EntityDescriptor', 'entityID') ?? '';
      const ssoUrl =
        xmlGetAttr(xml, 'SingleSignOnService', 'Location') ?? '';
      const certificate = xmlGetText(xml, 'X509Certificate') ?? '';
      const nameIdFormat =
        xmlGetText(xml, 'NameIDFormat') ??
        'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

      if (!entityId || !ssoUrl || !certificate) {
        return err(
          new AuthError('IdP metadata missing required fields (entityID, SSO URL, or certificate)'),
        );
      }

      this.idpMetadata = { entityId, ssoUrl, certificate, nameIdFormat };
      return ok(undefined);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown error';
      return err(new AuthError(`SAML initialization error: ${message}`));
    }
  }

  // -----------------------------------------------------------------------
  // AuthnRequest generation
  // -----------------------------------------------------------------------

  /**
   * Creates a SAML AuthnRequest and returns the IdP redirect URL together
   * with the request ID (for later response correlation).
   */
  generateAuthRequest(): Result<{ url: string; id: string }, AuthError> {
    if (!this.idpMetadata) {
      return err(new AuthError('SAML not initialized — call initialize() first'));
    }

    this.requestCounter += 1;
    const id = `_coderag_${Date.now()}_${String(this.requestCounter)}`;
    const issueInstant = new Date().toISOString();

    const authnRequest = [
      '<samlp:AuthnRequest',
      ' xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      ` ID="${id}"`,
      ' Version="2.0"',
      ` IssueInstant="${issueInstant}"`,
      ` Destination="${this.idpMetadata.ssoUrl}"`,
      ` AssertionConsumerServiceURL="${this.config.spAcsUrl}"`,
      ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
      `  <saml:Issuer>${this.config.spEntityId}</saml:Issuer>`,
      '  <samlp:NameIDPolicy',
      `   Format="${this.idpMetadata.nameIdFormat}"`,
      '   AllowCreate="true" />',
      '</samlp:AuthnRequest>',
    ].join('\n');

    const encoded = Buffer.from(authnRequest).toString('base64');
    const separator = this.idpMetadata.ssoUrl.includes('?') ? '&' : '?';
    const url = `${this.idpMetadata.ssoUrl}${separator}SAMLRequest=${encodeURIComponent(encoded)}`;

    return ok({ url, id });
  }

  // -----------------------------------------------------------------------
  // AuthProvider implementation
  // -----------------------------------------------------------------------

  async authenticate(token: string): Promise<Result<AuthToken, AuthError>> {
    const userResult = await this.validateResponse(token);
    if (userResult.isErr()) {
      return err(userResult.error);
    }

    const user = userResult.value;
    const now = Math.floor(Date.now() / 1000);
    const authToken: AuthToken = {
      userId: user.id,
      email: user.email,
      roles: user.roles,
      exp: now + 3600, // 1 hour default
      iat: now,
    };
    return ok(authToken);
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
  // SAML Response validation
  // -----------------------------------------------------------------------

  /**
   * Validates a Base64-encoded SAML Response: checks XML signature,
   * conditions (audience, timestamps), and extracts the user.
   */
  async validateResponse(samlResponseB64: string): Promise<Result<User, AuthError>> {
    let xml: string;
    try {
      xml = Buffer.from(samlResponseB64, 'base64').toString('utf-8');
    } catch {
      return err(new AuthError('Invalid Base64 SAML response'));
    }

    // Verify signature
    const sigResult = this.verifyXmlSignature(xml);
    if (sigResult.isErr()) {
      return err(sigResult.error);
    }

    // Check conditions
    const condResult = this.checkConditions(xml);
    if (condResult.isErr()) {
      return err(condResult.error);
    }

    // Extract user
    const user = this.mapAttributes(extractSamlAttributes(xml), xml);
    this.userCache.set(user.id, user);
    return ok(user);
  }

  // -----------------------------------------------------------------------
  // Attribute mapping
  // -----------------------------------------------------------------------

  /**
   * Maps SAML attributes to a CodeRAG `User`.
   */
  mapAttributes(attributes: Readonly<Record<string, string>>, xml?: string): User {
    const email =
      attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ??
      attributes['email'] ??
      attributes['Email'] ??
      '';

    const name =
      attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ??
      attributes['displayName'] ??
      attributes['name'] ??
      email;

    // Extract NameID as user ID
    let nameId = '';
    if (xml) {
      nameId = xmlGetText(xml, 'NameID') ?? '';
    }
    const id = nameId || email;

    // Map roles
    const roleAttr =
      attributes['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ??
      attributes['role'] ??
      attributes['Role'] ??
      '';

    const roles = this.mapRoleValues(roleAttr);

    return { id, email, name, roles, allowedRepos: [] };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private mapRoleValues(roleValue: string): readonly Role[] {
    const mapping = this.config.roleMapping ?? {};
    const values = roleValue
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    const roles = new Set<Role>();
    for (const value of values) {
      const mapped = mapping[value];
      if (mapped) {
        roles.add(mapped);
      }
      if (value === 'admin' || value === 'developer' || value === 'viewer') {
        roles.add(value);
      }
    }

    if (roles.size === 0) {
      return ['viewer'];
    }
    return [...roles];
  }

  private verifyXmlSignature(xml: string): Result<void, AuthError> {
    if (!this.idpMetadata) {
      return err(new AuthError('SAML not initialized — call initialize() first'));
    }

    // Extract SignatureValue and signed content
    const signatureValue = xmlGetText(xml, 'SignatureValue');
    if (!signatureValue) {
      return err(new AuthError('No SignatureValue found in SAML response'));
    }

    // Extract the signed content (the Assertion element)
    const digestValue = xmlGetText(xml, 'DigestValue');
    if (!digestValue) {
      return err(new AuthError('No DigestValue found in SAML response'));
    }

    // Verify using the IdP certificate or public key
    const signedInfo = xmlGetText(xml, 'SignedInfo');
    if (!signedInfo) {
      return err(new AuthError('No SignedInfo found in SAML response'));
    }

    // Reconstruct SignedInfo as canonical XML for verification
    const signedInfoXml = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}</SignedInfo>`;
    const signature = Buffer.from(signatureValue.replace(/\s/g, ''), 'base64');

    // Try certificate format first, then public key format
    const keyFormats = [
      `-----BEGIN CERTIFICATE-----\n${this.idpMetadata.certificate}\n-----END CERTIFICATE-----`,
      `-----BEGIN PUBLIC KEY-----\n${this.idpMetadata.certificate}\n-----END PUBLIC KEY-----`,
    ];

    for (const keyPem of keyFormats) {
      try {
        const verifier = createVerify('RSA-SHA256');
        verifier.update(signedInfoXml);
        const valid = verifier.verify(keyPem, signature);
        if (valid) {
          return ok(undefined);
        }
        return err(new AuthError('Invalid SAML response signature'));
      } catch {
        // Try next format
        continue;
      }
    }

    return err(new AuthError('Signature verification failed: unsupported key format'));
  }

  private checkConditions(xml: string): Result<void, AuthError> {
    // Check NotBefore / NotOnOrAfter
    const notBeforeStr = xmlGetAttr(xml, 'Conditions', 'NotBefore');
    const notOnOrAfterStr = xmlGetAttr(xml, 'Conditions', 'NotOnOrAfter');
    const now = new Date();

    if (notBeforeStr) {
      const notBefore = new Date(notBeforeStr);
      if (now < notBefore) {
        return err(new AuthError('SAML assertion not yet valid'));
      }
    }

    if (notOnOrAfterStr) {
      const notOnOrAfter = new Date(notOnOrAfterStr);
      if (now >= notOnOrAfter) {
        return err(new AuthError('SAML assertion expired'));
      }
    }

    // Check audience restriction
    const audience = xmlGetText(xml, 'Audience');
    if (audience && audience !== this.config.spEntityId) {
      return err(
        new AuthError(
          `SAML audience mismatch: expected ${this.config.spEntityId}, got ${audience}`,
        ),
      );
    }

    return ok(undefined);
  }
}
