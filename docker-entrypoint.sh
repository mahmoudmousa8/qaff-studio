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

if [ "$QAFF_SUSPENDED" = "true" ]; then
  echo "Container is SUSPENDED. Booting lightweight HTTP responder..."
  exec node -e "
    const http = require('http');
    http.createServer((req, res) => {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html dir=\"rtl\"><body style=\"display:flex;justify-content:center;align-items:center;height:100px;margin-top:20vh;background:#0f1117;color:#f87171;font-family:sans-serif;font-size:2rem;font-weight:bold;text-align:center;line-height:1.5\">عفواً، هذه اللوحة متوقفة مؤقتاً.<br>يرجى التواصل مع الدعم الفني.</body></html>');
    }).listen(3000, () => console.log('Suspension server running on 3000'));
  "
else
  exec node .next/standalone/server.js
fi
