# Stage 1: Build
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# Copy package.json files for all packages (for dependency resolution)
COPY packages/core/package.json packages/core/package.json
COPY packages/api-server/package.json packages/api-server/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core/ packages/core/
COPY packages/api-server/ packages/api-server/

# Build packages (core first, then api-server)
RUN pnpm --filter @coderag/core build && pnpm --filter @coderag/api-server build

# Stage 2: Production runtime
FROM node:20-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy built packages (dist + package.json only)
COPY packages/core/package.json packages/core/package.json
COPY --from=builder /app/packages/core/dist packages/core/dist

COPY packages/api-server/package.json packages/api-server/package.json
COPY --from=builder /app/packages/api-server/dist packages/api-server/dist

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Environment configuration
ENV CODERAG_PORT=3100
ENV NODE_ENV=production

EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/health || exit 1

# Run the API server
CMD ["node", "packages/api-server/dist/index.js"]
