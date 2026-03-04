/**
 * PM2 Ecosystem Configuration — Qaff Studio Streaming
 *
 * The deploy.sh script automatically patches the `cwd` paths below.
 * To start manually:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup   ← then run the sudo command it shows
 */

const path = require('path')
// Use __dirname so the config works from any directory
const PROJECT_DIR = __dirname

module.exports = {
  apps: [
    // ── Web App (Next.js on port 3000) ─────────────────────
    {
      name: 'qaff-web',
      script: '.next/standalone/server.js',
      cwd: PROJECT_DIR,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
      },
      error_file: path.join(PROJECT_DIR, 'data/logs/web-error.log'),
      out_file: path.join(PROJECT_DIR, 'data/logs/web-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },

    // ── Stream Manager (port 3002) ──────────────────────────
    {
      name: 'qaff-stream-manager',
      // Use tsx (works with Node 20) — if bun is installed, deploy.sh can switch
      script: 'index.ts',
      cwd: path.join(PROJECT_DIR, 'mini-services/stream-manager'),
      interpreter: 'tsx',          // npm install -g tsx (installed by install.sh)
      interpreter_args: '',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: path.join(PROJECT_DIR, 'data/logs/stream-manager-error.log'),
      out_file: path.join(PROJECT_DIR, 'data/logs/stream-manager-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
}
