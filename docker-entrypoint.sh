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
    const fs = require('fs');
    const path = require('path');
    http.createServer((req, res) => {
      if (req.url === '/logo-white.png') {
        try {
          const img = fs.readFileSync(path.join(__dirname, 'public', 'logo-white.png'));
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(img);
        } catch (e) {
          res.writeHead(404);
          res.end();
        }
        return;
      }
      try {
        const html = fs.readFileSync(path.join(__dirname, 'public', 'suspended.html'), 'utf8');
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch(e) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('Suspended');
      }
    }).listen(3000, () => console.log('Suspension server running on 3000'));
  "
else
  echo "Booting Stream Manager Daemon (Port 3002) in background..."
  NODE_ENV=production tsx /app/mini-services/stream-manager/index.ts &
  
  # Apply egress bandwidth throttling if a limit is set
  if [ -n "$BANDWIDTH_LIMIT_MBPS" ] && [ "$BANDWIDTH_LIMIT_MBPS" -gt 0 ] 2>/dev/null; then
    echo "Applying Bandwidth Limit: ${BANDWIDTH_LIMIT_MBPS} Mbps..."
    tc qdisc del dev eth0 root 2>/dev/null || true
    tc qdisc add dev eth0 root tbf rate ${BANDWIDTH_LIMIT_MBPS}mbit burst 32kbit latency 400ms
  fi

  echo "Booting Next.js Web Server (Port 3000)..."
  exec node .next/standalone/server.js
fi
