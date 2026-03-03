#!/bin/sh
# docker-entrypoint.sh — runs inside each client container
set -e

# Run Prisma migrations / push schema
npx prisma db push --skip-generate 2>/dev/null || true

# Set admin password from ENV if provided (ADMIN_PASSWORD_HASH)
if [ -n "$ADMIN_PASSWORD_HASH" ]; then
  node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.adminUser.upsert({
      where: { id: 1 },
      update: { passwordHash: process.env.ADMIN_PASSWORD_HASH },
      create: { id: 1, passwordHash: process.env.ADMIN_PASSWORD_HASH }
    }).then(() => p.\$disconnect()).catch(() => p.\$disconnect());
  " 2>/dev/null || true
fi

# Set TOTAL_SLOTS via DB if supported
if [ -n "$TOTAL_SLOTS" ]; then
  node -e "
    try {
      const db = require('better-sqlite3')(process.env.DATABASE_URL.replace('file:',''));
      db.pragma('journal_mode = WAL');
    } catch {}
  " 2>/dev/null || true
fi

exec node .next/standalone/server.js
