# syntax=docker/dockerfile:1
# Frontend Dockerfile for MinusX BI - Multi-stage build with standalone mode

# Preserve esbuild's exact JavaScript/binary protocol while rebuilding its Go runtime.
FROM golang:1.27.3-bookworm@sha256:972b4110ba0f47539a975c31e52c64765e1ff19f2d74469ae4a595c6676e80a5 AS esbuild-runtime
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN for version in 0.28.1 0.28.2; do \
      mkdir -p /build/$version /out/$version; cd /build/$version; \
      go mod init build-source \
      && go mod download github.com/evanw/esbuild@v$version \
      && cp -R "$(go env GOPATH)/pkg/mod/github.com/evanw/esbuild@v$version/." . \
      && chmod -R u+w . \
      && go mod edit -require=golang.org/x/sys@v0.44.0 \
      && go mod download golang.org/x/sys \
      && go build -trimpath -ldflags='-s -w' -o /out/$version/esbuild ./cmd/esbuild \
      && test "$(/out/$version/esbuild --version)" = "$version" || exit 1; \
    done

# ===== BUILDER STAGE ===== #
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS base
COPY scripts/patch-npm.mjs /tmp/patch-npm.mjs
RUN npm install --global --no-audit --no-fund npm@12.2.1 \
    && node /tmp/patch-npm.mjs && npm cache clean --force

FROM base AS builder

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

COPY --from=esbuild-runtime /out /opt/esbuild
COPY scripts/patch-esbuild.mjs /tmp/patch-esbuild.mjs
RUN node /tmp/patch-esbuild.mjs

# Verify the pi-ai patch (web search + image-URL support) was actually applied
# by postinstall. patch-package --error-on-fail silently exits 0 when no patches
# are found, and buildkit can cache an unpatched npm ci layer that silently
# ships broken images. This grep fails the build the instant that happens, so
# we never silently ship an unpatched pi-ai again.
RUN grep -q "MX PATCH" node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js \
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

# Precompile the setup-cli entries (install.sh runs them via `docker run`) to
# plain JS. They must NOT be transpiled at run time: the published image is
# amd64, so on Apple Silicon it runs emulated, and tsx's esbuild service dies
# there ("The service was stopped: write EPIPE") — which silently degraded
# install.sh's LLM/database validation to "no response". Bundling happens here,
# natively on the build host; the container then only runs `node`.
RUN npm run build:setup-cli

# ===== RUNTIME STAGE ===== #
FROM base AS runner

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV BASE_DUCKDB_DATA_PATH=/app
ENV DB_TYPE=pglite
ENV PGLITE_DATA_DIR=/app/data/pglite

# Install curl and ca-certificates for downloading DuckDB files
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy standalone output (much smaller than node_modules - only runtime dependencies)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/.npmrc ./.npmrc
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy database scripts and lib for initialization.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
# Template files are DATA read at boot (lib/templates), not imports, so Next's
# output tracing never sees them — they must be copied explicitly, like scripts/.
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# The precompiled setup-cli (plain JS, no runtime transpile) — install.sh runs
# these with `docker run … node setup-cli/<entry>.js`.
COPY --from=builder /app/setup-cli ./setup-cli

# Install tsx + re-apply pi-ai patches. The npm install restores native deps
# (libduckdb.so) that standalone tracing can't follow, but also overwrites the
# patched pi-ai with the upstream tarball — so patches are re-applied after.
# @tailwindcss/node|oxide + tailwindcss: the story design-system compiler
# (lib/data/story/story-css.server.ts) imports these at RUNTIME (they're
# serverExternalPackages — oxide is a native addon that can't be bundled), so
# standalone tracing misses them; installing here guarantees they exist with
# the right linux native bindings.
COPY --from=builder /app/patches ./patches
# @aws/lambda-invoke-store: aws-sdk transitive that standalone tracing misses.
# The setup-cli bundle keeps node_modules external, so it must resolve here.
# Restore the complete locked production graph: traced directories can omit
# files needed by dynamic imports even when npm sees the correct package version.
RUN rm -rf node_modules \
    && npm ci --omit=dev --ignore-scripts \
    && npm install --omit=dev --ignore-scripts tsx@4.21.0 "@tailwindcss/node@4.2.1" "@tailwindcss/oxide@4.2.1" "tailwindcss@4.2.1" "@aws/lambda-invoke-store@0.2.4"
COPY --from=esbuild-runtime /out /opt/esbuild
COPY scripts/patch-esbuild.mjs /tmp/patch-esbuild.mjs
RUN node /tmp/patch-esbuild.mjs
# npm's runtime reconciliation replaces package files while scripts are disabled.
# Retain the binding compiled against this exact lock and Node ABI in the builder.
COPY --from=builder /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node
RUN npx --yes patch-package@8.0.1 --error-on-fail \
    && rm -rf ./patches && npm cache clean --force
RUN grep -q "MX PATCH" /app/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js \
    || (echo "ERROR: pi-ai patch missing from runtime image" && exit 1)

# Create data directories (docker-compose volumes mount over these; standalone runs use them directly)
RUN mkdir -p /app/data/pglite /app/data/analytics

# Expose frontend port
EXPOSE 3000

CMD ["sh", "-c", "node server.js"]
