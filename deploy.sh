#!/usr/bin/env bash
#
# Qaff Studio — Deploy Script (with Admin Panel)
# Builds and restarts all services via PM2.
# Run: chmod +x deploy.sh && ./deploy.sh
#
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
NC="\033[0m"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADMIN_DIR="/opt/qaff-admin"

echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Qaff Studio — Deploy${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}\n"

cd "$PROJECT_DIR"

# 1. Build production bundle
echo -e "${GREEN}[1/3]${NC} Building production bundle..."
npm run build 2>&1 | tail -5
echo -e "  ✅ Build complete"

# 2. Restart main app via PM2
echo -e "\n${GREEN}[2/3]${NC} Restarting main app via PM2..."
pm2 restart ecosystem.config.cjs --update-env 2>&1 || pm2 start ecosystem.config.cjs 2>&1
pm2 save 2>/dev/null || true
echo -e "  ✅ Main app restarted"

# 3. Start/restart Admin Panel via PM2
echo -e "\n${GREEN}[3/3]${NC} Starting Admin Panel via PM2..."
if [ -d "$ADMIN_DIR" ]; then
  pm2 restart "$ADMIN_DIR/ecosystem.admin.cjs" --update-env 2>&1 || \
  pm2 start "$ADMIN_DIR/ecosystem.admin.cjs" 2>&1
  pm2 save 2>/dev/null || true
  echo -e "  ✅ Admin panel restarted"
else
  echo -e "  ${RED}Admin panel not found at $ADMIN_DIR — run install.sh first${NC}"
fi

# Setup PM2 startup on boot (first time only)
pm2 startup 2>/dev/null | grep -E "sudo" | bash 2>/dev/null || true

pm2 status

SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "\n${BOLD}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deployment complete!${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e ""
echo -e "  🎛️  Admin Panel:    ${BOLD}http://${SERVER_IP}:4000${NC}"
echo -e "  🔑  Admin Password: ${BOLD}Admin123@${NC}"
echo -e ""
echo -e "  📡  Main App:       ${BOLD}http://${SERVER_IP}:3000${NC}"
echo -e ""
