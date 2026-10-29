# Docs Dockerfile - Static export served by lightweight HTTP server
# Build from the repository root: docker build -f docs/Dockerfile .

# ===== BUILDER STAGE ===== #
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS builder

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

COPY docs/package*.json docs/.npmrc ./
RUN npm install --global --no-audit --no-fund npm@12.2.1 && npm ci

# Keep frontend/compatibility.json as the one shared compatibility contract.
# Its destination preserves components/compatibility-tables.tsx's relative import.
COPY docs/ .
COPY frontend/compatibility.json /frontend/compatibility.json
RUN npm run build

# ===== RUNTIME STAGE ===== #
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS runner

RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
    && npm install --global --no-audit --no-fund serve@14.2.6

COPY --from=builder /app/out /app/out

EXPOSE 3001

CMD ["serve", "/app/out", "-l", "3001"]
