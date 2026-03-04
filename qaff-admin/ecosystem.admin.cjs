'use strict'
// ecosystem.admin.cjs — PM2 config for Qaff Admin Panel
const path = require('path')
const ADMIN_DIR = '/opt/qaff-admin'

module.exports = {
    apps: [
        {
            name: 'qaff-admin',
            script: 'server.js',
            cwd: ADMIN_DIR,
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '200M',
            env: {
                NODE_ENV: 'production',
                ADMIN_PORT: 4000,
            },
            error_file: path.join(ADMIN_DIR, 'data/logs/admin-error.log'),
            out_file: path.join(ADMIN_DIR, 'data/logs/admin-out.log'),
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
        }
    ]
}
