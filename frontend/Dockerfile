# syntax=docker/dockerfile:1
# Frontend Dockerfile for MinusX BI - Multi-stage build with standalone mode

# ===== BUILDER STAGE ===== #
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Install dependencies for native modules (better-sqlite3, lightningcss)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and postinstall inputs (needed during npm ci).
# `patches/` MUST be present before `npm ci` so postinstall's patch-package
# applies the pi-ai patch (web search + image-URL support). Without it,
# patch-package silently finds no patches and ships an unpatched pi.
COPY package*.json .npmrc ./
COPY scripts/copy-duckdb-wasm.mjs ./scripts/copy-duckdb-wasm.mjs
COPY patches ./patches

RUN --mount=type=cache,target=/root/.npm \
    npm ci --cache /root/.npm

# Copy application source
COPY . .

# Dummy secret satisfies build-time validation; real value is set at runtime via docker-compose
ENV NEXTAUTH_SECRET=build-placeholder

# Build Next.js application (generates .next/standalone)
# Accept git commit SHA from CI build arg — embedded into the Next.js build by next.config.ts
ARG GIT_COMMIT_SHA
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ARG NEXT_PUBLIC_DEFAULT_ANALYTICS_CONFIG
ENV NEXT_PUBLIC_DEFAULT_ANALYTICS_CONFIG=$NEXT_PUBLIC_DEFAULT_ANALYTICS_CONFIG
# Sentry auth token (optional) is mounted as a secret so it never lands in an
# image layer; when present, the Sentry plugin uploads source maps during build.
RUN --mount=type=cache,target=/app/.next/cache \
    --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    CI=true \
    SENTRY_LOG_LEVEL=debug \
    sh -c 'echo "[sentry-debug] token byte length=${#SENTRY_AUTH_TOKEN}"; \
           echo "[sentry-debug] auth probe (project read):"; \
           curl -sS -o /dev/null -w "[sentry-debug] HTTP %{http_code}\n" \
                -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
                https://sentry.io/api/0/projects/minusx/minusx-bi/; \
           npm run build'

# ===== RUNTIME STAGE ===== #
FROM node:20-slim AS runner

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV BASE_DUCKDB_DATA_PATH=/app
ENV DB_TYPE=pglite
ENV PGLITE_DATA_DIR=/app/data/pglite

# Install curl and ca-certificates for downloading DuckDB files
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy standalone output (much smaller than node_modules - only runtime dependencies)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy database scripts and lib for initialization
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Install tsx for running TypeScript scripts
RUN npm install --ignore-scripts tsx

# Create data directories (docker-compose volumes mount over these; standalone runs use them directly)
RUN mkdir -p /app/data/pglite /app/data/analytics

# Expose frontend port
EXPOSE 3000

CMD ["sh", "-c", "node server.js"]
