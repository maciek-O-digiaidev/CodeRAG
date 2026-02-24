---
tags:
  - guide
  - deployment
  - cloud
  - api-server
  - authentication
  - rbac
aliases:
  - cloud-deployment
  - deployment
  - api-server-guide
---

# Cloud Deployment

CodeRAG includes a full-featured API server (`@code-rag/api-server`) for team deployments. It wraps all CodeRAG functionality behind a REST API with authentication, rate limiting, RBAC, and a built-in admin dashboard.

## Quick Start

```bash
# Set API keys and start the server
export CODERAG_API_KEYS="dev-key-abc,admin-key-xyz:admin"
coderag serve --port 3100

# Or run via Docker
docker run -p 3100:3100 \
  -e CODERAG_API_KEYS="dev-key-abc,admin-key-xyz:admin" \
  -v /path/to/project:/workspace \
  coderag/api-server
```

## API Server Architecture

```mermaid
flowchart TD
    Client[Client / AI Agent] --> Health[GET /health]
    Client --> OpenAPI[GET /api/openapi.json]
    Client --> Auth[Auth Middleware]
    Auth --> RateLimit[Rate Limiter]
    RateLimit --> Search[/api/v1/search]
    RateLimit --> Context[/api/v1/context]
    RateLimit --> Status[/api/v1/status]
    RateLimit --> Index[/api/v1/index]
    RateLimit --> Team[/api/v1/team]
    RateLimit --> History[/api/v1/history]
    RateLimit --> Viewer[/api/v1/viewer]
    Client --> Dashboard[/dashboard - Admin Only]
```

The server initializes core services on startup: config loading, LanceDB connection, BM25 index, hybrid search, re-ranker, and dependency graph.

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `CODERAG_API_KEYS` | (none) | Comma-separated API keys. See Authentication below |
| `CODERAG_RATE_LIMIT` | `60` | Maximum requests per window per key |
| `CODERAG_RATE_WINDOW_MS` | `60000` | Rate limit window in milliseconds |
| `PORT` | `3100` | Server listen port |
| `CODERAG_CORS_ORIGIN` | `*` | CORS `Access-Control-Allow-Origin` value |

> [!note]
> When `CODERAG_API_KEYS` is empty or unset, authentication is disabled entirely. This is intended for local development only. Always set API keys in production.

## Authentication

### API Key Format

The `CODERAG_API_KEYS` environment variable accepts comma-separated keys. Append `:admin` to grant admin privileges:

```
CODERAG_API_KEYS="readonly-key-1,dev-key-2,super-admin-key:admin"
```

This creates three keys:
- `readonly-key-1` -- standard access
- `dev-key-2` -- standard access
- `super-admin-key` -- admin access

### Providing Keys in Requests

API keys can be sent via either header:

```bash
# Authorization header
curl -H "Authorization: Bearer dev-key-2" \
  http://localhost:3100/api/v1/search?q=auth

# X-API-Key header
curl -H "X-API-Key: dev-key-2" \
  http://localhost:3100/api/v1/search?q=auth
```

### Unauthenticated Endpoints

These endpoints do not require authentication:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (`{ status: "ok" }`) |
| `GET /api/openapi.json` | OpenAPI 3.0 specification |

### Enterprise Authentication (OIDC / SAML)

For enterprise deployments, CodeRAG supports OIDC and SAML authentication providers. These map external identity provider groups to CodeRAG roles via a `roleMapping` configuration:

```typescript
// OIDC Configuration
interface OIDCConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
  roleMapping?: Record<string, Role>; // e.g., { "engineering": "developer" }
}

// SAML Configuration
interface SAMLConfig {
  idpMetadataUrl: string;
  spEntityId: string;
  spAcsUrl: string;
  certificatePem: string;
  roleMapping?: Record<string, Role>;
}
```

## RBAC: Role-Based Access Control

CodeRAG defines three roles in a strict hierarchy:

```
admin > developer > viewer
```

### Permissions Table

| Action | viewer | developer | admin |
|--------|--------|-----------|-------|
| `search` | Yes | Yes | Yes |
| `context` | Yes | Yes | Yes |
| `status` | Yes | Yes | Yes |
| `explain` | -- | Yes | Yes |
| `docs` | -- | Yes | Yes |
| `index` | -- | -- | Yes |
| `configure` | -- | -- | Yes |

### Repository-Level Access

Users have an `allowedRepos` list controlling which repositories they can access:

- Results from unauthorized repos are filtered out of search results automatically
- Admin users with an **empty** `allowedRepos` list get unrestricted access to all repos
- Single-repo setups (no `repoName` in metadata) skip repo-level filtering

> [!warning]
> Admin keys created via `CODERAG_API_KEYS` have full access. For fine-grained repo-level access control, use the OIDC/SAML providers with role mapping.

## Rate Limiting

The API server uses a **token bucket** rate limiter. Each API key (or IP address for unauthenticated requests) gets its own bucket.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CODERAG_RATE_LIMIT` | `60` | Tokens (requests) per window |
| `CODERAG_RATE_WINDOW_MS` | `60000` | Window size in milliseconds |

### Response Headers

Every response includes rate limit headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
```

When the limit is exceeded, the server returns `429 Too Many Requests` with a `Retry-After` header:

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 3 second(s).",
  "retry_after": 3
}
```

## Docker Setup

A `Dockerfile` is included in the `packages/api-server` package:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
EXPOSE 3100
CMD ["node", "packages/api-server/dist/main.js"]
```

### Docker Compose Example

```yaml
version: "3.8"
services:
  coderag:
    build: .
    ports:
      - "3100:3100"
    environment:
      - CODERAG_API_KEYS=my-secret-key:admin
      - CODERAG_RATE_LIMIT=120
    volumes:
      - /path/to/project:/workspace
      - coderag-data:/workspace/.coderag
    working_dir: /workspace

volumes:
  coderag-data:
```

## Team Storage Providers

For team deployments, CodeRAG supports shared storage backends to synchronize the index across team members:

| Provider | Use Case |
|----------|----------|
| **S3** | AWS deployments |
| **Azure Blob Storage** | Azure deployments |
| **GCS** | Google Cloud deployments |

Configure team storage via the `/api/v1/team` endpoints. The team sync workflow:

1. **Connect** -- register team members via the team API
2. **Push** -- upload the local index to shared storage after indexing
3. **Pull** -- download the shared index to a new machine
4. **Analytics** -- view team usage statistics

> [!tip]
> Team storage is optional. For single-developer use or CI/CD pipelines, the local embedded storage (LanceDB) is sufficient.

## Admin Dashboard

The API server includes a server-rendered admin dashboard at `/dashboard`:

- **Overview**: index stats, request counts, active keys
- **Request tracking**: method, path, timestamp, API key usage
- **Index management**: trigger re-indexing from the UI
- **Configuration viewer**: current `.coderag.yaml` settings

> [!note]
> The dashboard requires an admin API key. Access it at `http://localhost:3100/dashboard`.

## See Also

- [[api-server]] -- API server package details
- [[rest-api]] -- full REST API endpoint reference
- [[interfaces]] -- provider interfaces (auth, storage, embedding)
