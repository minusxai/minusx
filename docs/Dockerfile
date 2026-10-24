# Docs Dockerfile - Static export served by lightweight HTTP server
# Build from the repository root: docker build -f docs/Dockerfile .

# ===== BUILDER STAGE ===== #
FROM node:22.23.4-slim AS builder
COPY docs/scripts/patch-npm.mjs /tmp/patch-npm.mjs
RUN npm install --global --no-audit --no-fund npm@12.2.1 \
    && node /tmp/patch-npm.mjs && npm cache clean --force

WORKDIR /app

COPY docs/package*.json docs/.npmrc ./
RUN npm ci

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
    && npm install --omit=dev --ignore-scripts --prefix /usr/local/lib/node_modules/serve compression@1.8.2

COPY --from=builder /app/out /app/out

EXPOSE 3001

CMD ["serve", "/app/out", "-l", "3001"]
