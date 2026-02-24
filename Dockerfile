# ============================================================================
# CodeRAG — Multi-stage Docker build
# Produces a minimal production image with CLI, MCP server, and API server.
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build — compile TypeScript, install all dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

# Install build tools needed by native modules (LanceDB, tree-sitter)
RUN apk add --no-cache python3 make g++ git

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace configuration first (for Docker layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# Copy package.json files for all packages (dependency resolution)
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/api-server/package.json packages/api-server/package.json
COPY packages/viewer/package.json packages/viewer/package.json
COPY packages/benchmarks/package.json packages/benchmarks/package.json

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code for all packages
COPY packages/core/ packages/core/
COPY packages/cli/ packages/cli/
COPY packages/mcp-server/ packages/mcp-server/
COPY packages/api-server/ packages/api-server/
COPY packages/viewer/ packages/viewer/
COPY packages/benchmarks/ packages/benchmarks/

# Build all packages in dependency order
RUN pnpm run build

# ---------------------------------------------------------------------------
# Stage 2: Production — minimal runtime image
# ---------------------------------------------------------------------------
FROM node:22-alpine AS production

# Install runtime dependencies: git (for simple-git) and wget (for healthcheck)
RUN apk add --no-cache git

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy built packages (dist + package.json only)
COPY packages/core/package.json packages/core/package.json
COPY --from=builder /app/packages/core/dist packages/core/dist

COPY packages/cli/package.json packages/cli/package.json
COPY --from=builder /app/packages/cli/dist packages/cli/dist

COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY --from=builder /app/packages/mcp-server/dist packages/mcp-server/dist

COPY packages/api-server/package.json packages/api-server/package.json
COPY --from=builder /app/packages/api-server/dist packages/api-server/dist

COPY packages/viewer/package.json packages/viewer/package.json
COPY --from=builder /app/packages/viewer/dist packages/viewer/dist

COPY packages/benchmarks/package.json packages/benchmarks/package.json

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Create data directory for persistent storage
RUN mkdir -p /data/.coderag

# Run as non-root user for security
RUN addgroup -S coderag && adduser -S coderag -G coderag
RUN chown -R coderag:coderag /app /data
USER coderag

# Environment configuration
ENV NODE_ENV=production
ENV CODERAG_PORT=3000
ENV CODERAG_MCP_PORT=3001
ENV CODERAG_VIEWER_PORT=5173
ENV OLLAMA_HOST=http://ollama:11434

# Expose service ports
# 3000 — API server
# 3001 — MCP server (SSE transport)
# 5173 — Viewer SPA
EXPOSE 3000 3001 5173

# Health check against the API server /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Default entrypoint: CLI (supports all commands: index, search, serve, status, etc.)
ENTRYPOINT ["node", "packages/cli/dist/index.js"]

# Default command: show help
CMD ["--help"]
