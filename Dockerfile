# Qaff Studio — Dockerfile
# Build image: docker build -t qaff-studio:latest .

FROM node:20-alpine

# Install ffmpeg + sqlite
RUN apk add --no-cache ffmpeg sqlite

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install deps
RUN npm install --production=false

# Copy remaining source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
RUN npm run build

# Expose app port
EXPOSE 3000

# Runtime env defaults (can be overridden via docker run -e)
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/app.db \
    TOTAL_SLOTS=50

# Data dir will be mounted as a volume by qaff-admin
VOLUME ["/data"]

# Bootstrap entrypoint: run prisma migrate then start the app
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
