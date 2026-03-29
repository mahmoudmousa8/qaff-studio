# Qaff Studio — Multi-Stage Dockerfile

# ==========================================
# STAGE 1: BUILDER
# ==========================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies (libc compat + native addon build tools for better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files first to leverage Docker layer caching
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies required for Next.js build)
# Clean the npm cache immediately after to keep the layer lean
RUN npm install && npm cache clean --force

# Copy the rest of the source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the Next.js application (outputs to .next/standalone/ because of next.config.mjs)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ==========================================
# STAGE 2: RUNNER (Production Image)
# ==========================================
FROM node:20-bookworm-slim AS runner

# Install necessary runtime system packages
RUN apt-get update && apt-get install -y ffmpeg sqlite3 iproute2 openssl procps wget && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Copy package data
COPY --from=builder /app/package.json ./

# Copy Prisma schema, generated client, and CLI executable
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/prisma ./prisma

# Copy better-sqlite3: only the compiled native addon + its JS module (no build tools)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Copy mini-services (required for stream-manager background daemon)
COPY --from=builder /app/mini-services ./mini-services

# Install TSX globally to run the Stream Manager
RUN npm install -g tsx

# Copy the standalone Next.js server into the expected .next/standalone path 
# (The package.json build script already copies public/ and static/ inside it!)
COPY --from=builder /app/.next/standalone ./.next/standalone

# Rebuild the entrypoint correctly
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Runtime env defaults (Can be overridden by the Admin Panel on container creation)
ENV APP_DATA_DIR=/app/data \
    VIDEOS_DIR=/app/data/videos \
    UPLOAD_DIR=/app/data/upload \
    DOWNLOAD_DIR=/app/data/download \
    LOGS_DIR=/app/data/logs \
    DATABASE_URL=file:/app/data/app.db \
    TOTAL_SLOTS=50

# The data directory will be mounted by the Docker API in the admin panel
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["/docker-entrypoint.sh"]
