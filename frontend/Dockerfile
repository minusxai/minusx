# Frontend Dockerfile for Atlas BI v2 - Multi-stage build with standalone mode

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

# Copy package files
COPY package*.json ./

# Remove package-lock.json if exists and do fresh install (workaround for npm optional deps bug)
RUN rm -f package-lock.json && \
    npm install && \
    npm install --save-optional \
      lightningcss-linux-x64-gnu \
      @tailwindcss/oxide-linux-x64-gnu

# Copy application source
COPY . .

# Create directories and empty database for build
RUN mkdir -p data && npm run create-empty-db

# Build Next.js application (generates .next/standalone)
RUN npm run build

# ===== RUNTIME STAGE ===== #
FROM node:20-slim AS runner

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Install curl and ca-certificates for downloading DuckDB files
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy standalone output (much smaller than node_modules - only runtime dependencies)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data

# Copy database scripts and lib for initialization
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Install tsx for running TypeScript scripts
RUN npm install tsx

# Expose frontend port
EXPOSE 3000

# Set up PostgreSQL (if DB_TYPE=postgres), initialize database (if missing), run migrations (if needed), and start
# All setup steps are non-blocking - server will start even if they fail
# Standalone mode uses server.js as entry point
CMD ["sh", "-c", "(npm run setup-postgres 2>/dev/null || true) && (npm run import-db 2>/dev/null || true) && (npm run migrate-db || echo '⚠️  Migration failed, server starting anyway') && node server.js"]
