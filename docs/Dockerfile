# Docs Dockerfile - Static export served by lightweight HTTP server
# Build from the repository root: docker build -f docs/Dockerfile .

# ===== BUILDER STAGE ===== #
FROM node:20-slim AS builder

WORKDIR /app

COPY docs/package*.json docs/.npmrc ./
RUN rm -f package-lock.json && npm install

# Keep frontend/compatibility.json as the one shared compatibility contract.
# Its destination preserves components/compatibility-tables.tsx's relative import.
COPY docs/ .
COPY frontend/compatibility.json /frontend/compatibility.json
RUN npm run build

# ===== RUNTIME STAGE ===== #
FROM node:20-alpine AS runner

RUN npm install -g serve

COPY --from=builder /app/out /app/out

EXPOSE 3001

CMD ["serve", "/app/out", "-l", "3001"]
