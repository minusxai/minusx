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
    && rm -rf /var/lib/apt/lists/*

# Copy package files and postinstall script (needed during npm ci)
COPY package*.json ./
COPY scripts/copy-duckdb-wasm.mjs ./scripts/copy-duckdb-wasm.mjs

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
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

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
