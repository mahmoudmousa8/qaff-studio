#!/bin/sh
# docker-entrypoint.sh — runs inside each client container
set -e

# Initialize database schema directly using better-sqlite3 (no Prisma engine needed)
echo "Initializing database schema..."
node -e "
  const DB_PATH = (process.env.DATABASE_URL || '').replace(/^file:/, '');
  if (!DB_PATH) { console.error('[db] DATABASE_URL not set'); process.exit(1); }
  const db = require('better-sqlite3')(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(\`
    CREATE TABLE IF NOT EXISTS StreamSlot (
      id TEXT PRIMARY KEY,
      slotIndex INTEGER UNIQUE NOT NULL,
      channelName TEXT NOT NULL DEFAULT '',
      outputType TEXT NOT NULL DEFAULT 'youtube',
      streamKey TEXT NOT NULL DEFAULT '',
      rtmpServer TEXT NOT NULL DEFAULT 'rtmp://a.rtmp.youtube.com/live2',
      filePath TEXT NOT NULL DEFAULT '',
      schedStart TEXT NOT NULL DEFAULT '',
      schedStop TEXT NOT NULL DEFAULT '',
      daily INTEGER NOT NULL DEFAULT 0,
      weekly INTEGER NOT NULL DEFAULT 0,
      isScheduled INTEGER NOT NULL DEFAULT 0,
      manuallyStopped INTEGER NOT NULL DEFAULT 1,
      nextRunTime TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Stopped',
      isRunning INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    db.exec("ALTER TABLE StreamSlot ADD COLUMN manuallyStopped INTEGER NOT NULL DEFAULT 1;");
  } catch (e) {
    // Column already exists
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS SystemLog (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS AppSettings (
      id TEXT PRIMARY KEY,
      autoSave INTEGER NOT NULL DEFAULT 1,
      slotsCount INTEGER NOT NULL DEFAULT 50
    );
    CREATE TABLE IF NOT EXISTS AdminUser (
      id INTEGER PRIMARY KEY,
      passwordHash TEXT NOT NULL
    );
  \`);
  db.close();
  console.log('[db] Schema initialized successfully at: ' + DB_PATH);
"

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
  # ── Force IPv4 preference system-wide via gai.conf ───────────────────────
  # Docker bridge networking is unstable with IPv6 (NAT overhead, routing issues).
  # This makes ALL network connections (FFmpeg RTMP, Next.js, etc.) prefer IPv4.
  # The line sets IPv4-mapped addresses (::ffff:0:0/96) to highest precedence (100).
  echo "precedence ::ffff:0:0/96  100" > /etc/gai.conf
  echo "IPv4 preference applied via /etc/gai.conf"

  echo "Booting Stream Manager Daemon (Port 3002) in background..."
  
  if [ -f "/app/data/timezone.txt" ]; then
    export TZ=$(cat /app/data/timezone.txt)
    echo "Using Container Timezone: $TZ"
  fi

  (
    while true; do
      NODE_ENV=production tsx /app/mini-services/stream-manager/index.ts
      echo "Stream Manager exited. Restarting in 2 seconds..."
      sleep 2
    done
  ) &
  
  # Apply egress bandwidth throttling if a limit is set
  if [ -n "$BANDWIDTH_LIMIT_MBPS" ] && [ "$BANDWIDTH_LIMIT_MBPS" -gt 0 ] 2>/dev/null; then
    echo "Applying Bandwidth Limit: ${BANDWIDTH_LIMIT_MBPS} Mbps..."
    tc qdisc del dev eth0 root 2>/dev/null || true
    tc qdisc add dev eth0 root tbf rate ${BANDWIDTH_LIMIT_MBPS}mbit burst 2000kbit latency 50ms
  fi

  echo "Booting Next.js Web Server (Port 3000)..."
  exec node .next/standalone/server.js
fi
