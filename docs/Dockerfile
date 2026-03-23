# Docs Dockerfile - Static export served by lightweight HTTP server

# ===== BUILDER STAGE ===== #
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN rm -f package-lock.json && npm install

COPY . .
RUN npm run build

# ===== RUNTIME STAGE ===== #
FROM node:20-alpine AS runner

RUN npm install -g serve

COPY --from=builder /app/out /app/out

EXPOSE 3001

CMD ["serve", "/app/out", "-l", "3001"]
