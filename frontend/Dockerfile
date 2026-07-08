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
    ca-certificates \
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

# Verify the pi-ai patch (web search + image-URL support) was actually applied
# by postinstall. patch-package --error-on-fail silently exits 0 when no patches
# are found, and buildkit can cache an unpatched npm ci layer that silently
# ships broken images. This grep fails the build the instant that happens, so
# we never silently ship an unpatched pi-ai again.
RUN grep -q "MX PATCH" node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js \
    || (echo "ERROR: pi-ai patch not applied — postinstall did not run or patches/ missing at npm ci time" && exit 1)

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
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" npm run build

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

# Install tsx + re-apply pi-ai patches. The npm install restores native deps
# (libduckdb.so) that standalone tracing can't follow, but also overwrites the
# patched pi-ai with the upstream tarball — so patches are re-applied after.
# @tailwindcss/node|oxide + tailwindcss: the story design-system compiler
# (lib/data/story/story-css.server.ts) imports these at RUNTIME (they're
# serverExternalPackages — oxide is a native addon that can't be bundled), so
# standalone tracing misses them; installing here guarantees they exist with
# the right linux native bindings.
COPY --from=builder /app/patches ./patches
RUN npm install --ignore-scripts tsx "@tailwindcss/node@^4" "@tailwindcss/oxide@^4" "tailwindcss@^4"
RUN npx --yes patch-package --error-on-fail && rm -rf ./patches
RUN grep -q "MX PATCH" /app/node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js \
    || (echo "ERROR: pi-ai patch missing from runtime image" && exit 1)

# Create data directories (docker-compose volumes mount over these; standalone runs use them directly)
RUN mkdir -p /app/data/pglite /app/data/analytics

# Expose frontend port
EXPOSE 3000

CMD ["sh", "-c", "node server.js"]
