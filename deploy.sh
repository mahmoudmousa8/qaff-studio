#!/usr/bin/env bash
#
# Qaff Studio — Deploy Script
# Rebuilds Docker image + restarts Admin Panel via PM2
# Run: ./deploy.sh
#

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADMIN_DIR="/opt/qaff-admin"

echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Qaff Studio — Deploy${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}\n"

cd "$PROJECT_DIR"

# 1. Build Next.js production bundle
echo -e "${GREEN}[1/3]${NC} Building production bundle..."
pkill -f "next build" 2>/dev/null || true
sleep 1
sudo rm -rf "$PROJECT_DIR/.next"
npm run build 2>&1 | tail -5
echo -e "  ✅ Build complete"

# 2. Rebuild Docker image (used by Admin Panel per-client containers)
echo -e "\n${GREEN}[2/3]${NC} Rebuilding Docker image..."
docker build -t qaff-studio:latest "$PROJECT_DIR" 2>&1 | tail -5
echo -e "  ✅ Docker image qaff-studio:latest ready"

# 3. Restart Admin Panel via PM2
echo -e "\n${GREEN}[3/3]${NC} Restarting Admin Panel via PM2..."
if [ -f "$ADMIN_DIR/ecosystem.admin.cjs" ]; then
    pm2 reload "$ADMIN_DIR/ecosystem.admin.cjs" --update-env 2>/dev/null || \
    pm2 restart "$ADMIN_DIR/ecosystem.admin.cjs" --update-env 2>/dev/null || \
    pm2 start "$ADMIN_DIR/ecosystem.admin.cjs" 2>/dev/null
    pm2 save 2>/dev/null || true
    echo -e "  ✅ Admin panel restarted"
else
    echo -e "  ${RED}Admin panel not found at $ADMIN_DIR — run install.sh first${NC}"
fi

# Main qaff-web app is also restarted by PM2 (non-Docker mode)
pm2 reload ecosystem.config.cjs --update-env 2>/dev/null || \
pm2 restart ecosystem.config.cjs --update-env 2>/dev/null || true

pm2 save 2>/dev/null || true
pm2 status

SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "\n${BOLD}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deployment complete!${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e ""
echo -e "  🎛️  Admin Panel:    ${BOLD}http://${SERVER_IP}:4000${NC}"
echo -e "  🔑  Admin Password: ${BOLD}Admin123@${NC}"
echo -e ""
echo -e "  💡 Use Admin Panel to create/manage client containers"
echo -e ""
