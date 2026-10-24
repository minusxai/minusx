# Docs Dockerfile - Static export served by lightweight HTTP server
# Build from the repository root: docker build -f docs/Dockerfile .

# Preserve esbuild's exact JavaScript/binary protocol while rebuilding its Go runtime.
FROM golang:1.27.3-bookworm@sha256:972b4110ba0f47539a975c31e52c64765e1ff19f2d74469ae4a595c6676e80a5 AS esbuild-runtime
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN for version in 0.28.2; do \
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
FROM node:22.23.4-slim AS builder
COPY docs/scripts/patch-npm.mjs /tmp/patch-npm.mjs
RUN npm install --global --no-audit --no-fund npm@12.2.1 \
    && node /tmp/patch-npm.mjs && npm cache clean --force

WORKDIR /app

COPY docs/package*.json docs/.npmrc ./
RUN npm ci
COPY --from=esbuild-runtime /out /opt/esbuild
COPY docs/scripts/patch-esbuild.mjs /tmp/patch-esbuild.mjs
RUN node /tmp/patch-esbuild.mjs

# Keep frontend/compatibility.json as the one shared compatibility contract.
# Its destination preserves components/compatibility-tables.tsx's relative import.
COPY docs/ .
COPY frontend/compatibility.json /frontend/compatibility.json
RUN npm run build

# ===== RUNTIME STAGE ===== #
FROM node:22.23.4-alpine AS runner

COPY docs/scripts/patch-npm.mjs /tmp/patch-npm.mjs
RUN npm install --global --no-audit --no-fund npm@12.2.1 \
    && node /tmp/patch-npm.mjs && npm cache clean --force
RUN npm install -g serve@14.2.6 \
    && npm install --omit=dev --ignore-scripts --prefix /usr/local/lib/node_modules/serve compression@1.8.2 \
    && npm cache clean --force

COPY --from=builder /app/out /app/out

EXPOSE 3001

CMD ["serve", "/app/out", "-l", "3001"]
