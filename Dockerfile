# syntax=docker/dockerfile:1
# Multi-stage Alpine Dockerfile for AgentTrace self-hosting

# ============================================
# Builder stage: install tools, deps, build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install Python + build tools (required for pnpm + native better-sqlite3 compilation on musl/Alpine)
# Also g++/make for node-gyp
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    # libc compatibility sometimes needed for builds
    libc6-compat

# Enable pnpm via corepack (shipped with Node) and prepare a compatible version
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy only package manifests first (better layer caching for pnpm install)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/
COPY packages/middleware-langgraph/package.json packages/middleware-langgraph/
# Python packages (not pnpm but copied for completeness / future)
COPY packages/sdk-python/pyproject.toml packages/sdk-python/
COPY packages/middleware-crewai/pyproject.toml packages/middleware-crewai/

# Install all dependencies (dev + prod). This triggers better-sqlite3 native build.
RUN pnpm install --frozen-lockfile

# Copy the rest of the source (respecting .dockerignore)
COPY . .

# Build all packages (TS -> JS for sdk, dashboard, cli, langgraph middleware)
RUN pnpm build

# Remove dev dependencies for smaller runtime image
RUN pnpm prune --prod

# ============================================
# Runtime stage: minimal image with built app
# ============================================
FROM node:20-alpine AS runner

WORKDIR /app

# Copy only what is needed for runtime (no src, no dev deps, no tests/docs)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder /app/packages/dashboard/package.json ./packages/dashboard/
COPY --from=builder /app/packages/dashboard/dist ./packages/dashboard/dist
COPY --from=builder /app/packages/dashboard/public ./packages/dashboard/public
COPY --from=builder /app/packages/cli/package.json ./packages/cli/
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/middleware-langgraph/package.json ./packages/middleware-langgraph/
COPY --from=builder /app/packages/middleware-langgraph/dist ./packages/middleware-langgraph/dist

# Ensure data directory exists for SQLite DB (volume mount target)
RUN mkdir -p /app/data

# Environment
ENV NODE_ENV=production
ENV AGENTTRACE_DB_PATH=/app/data/agenttrace.db

# The dashboard listens on 4317 by default (OTLP-adjacent port for convenience)
EXPOSE 4317

# Run the CLI dashboard command directly.
# Use --host 0.0.0.0 so it is reachable from outside the container (default is 127.0.0.1)
CMD ["node", "packages/cli/dist/index.js", "dashboard", "--host", "0.0.0.0"]
