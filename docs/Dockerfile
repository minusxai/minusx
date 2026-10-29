# Docs Dockerfile - Static export served by lightweight HTTP server
# Build from the repository root: docker build -f docs/Dockerfile .

# ===== BUILDER STAGE ===== #
FROM node:22.23.4-trixie-slim@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f AS builder

RUN npm install --global --no-audit --no-fund npm@12.2.1

WORKDIR /app

COPY docs/package*.json docs/.npmrc ./
RUN rm -f package-lock.json && npm install

# Keep frontend/compatibility.json as the one shared compatibility contract.
# Its destination preserves components/compatibility-tables.tsx's relative import.
COPY docs/ .
COPY frontend/compatibility.json /frontend/compatibility.json
RUN npm run build

# ===== RUNTIME STAGE ===== #
FROM node:22.23.4-trixie-slim@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f AS runner

RUN npm install --global --no-audit --no-fund npm@12.2.1

RUN npm install -g serve

COPY --from=builder /app/out /app/out

EXPOSE 3001

CMD ["serve", "/app/out", "-l", "3001"]
