#!/usr/bin/env bash
#
# Qaff Studio — Deploy Script
# Builds Next.js, rebuilds Docker image, starts containers
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
MAIN_CONTAINER="qaff-studio"
MAIN_IMAGE="qaff-studio:latest"

echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Qaff Studio — Deploy${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}\n"

cd "$PROJECT_DIR"

# ── 1. Build Next.js ──────────────────────────────────────────
echo -e "${GREEN}[1/4]${NC} Building production bundle..."
pkill -f "next build" 2>/dev/null || true
sleep 1
sudo rm -rf "$PROJECT_DIR/.next"
npm run build 2>&1 | tail -5
echo -e "  ✅ Build complete"

# ── 2. Rebuild Docker image ───────────────────────────────────
echo -e "\n${GREEN}[2/4]${NC} Rebuilding Docker image..."
docker build -t "$MAIN_IMAGE" "$PROJECT_DIR" 2>&1 | tail -5
echo -e "  ✅ Docker image ${MAIN_IMAGE} ready"

# ── 3. Start/restart main container on port 3000 ────────────
echo -e "\n${GREEN}[3/4]${NC} Starting main app container on port 3000..."
# Stop & remove old container (ignore errors if not exists)
docker stop "$MAIN_CONTAINER" 2>/dev/null || true
docker rm   "$MAIN_CONTAINER" 2>/dev/null || true
# Run fresh container
docker run -d \
    --name "$MAIN_CONTAINER" \
    --restart unless-stopped \
    -p 3000:3000 \
    -v qaff_main_data:/data \
    "$MAIN_IMAGE"
echo -e "  ✅ Main app container started on port 3000"

# ── 4. Start/restart Admin Panel via PM2 on port 4000 ────────
echo -e "\n${GREEN}[4/4]${NC} Restarting Admin Panel via PM2..."
if [ -f "$ADMIN_DIR/ecosystem.admin.cjs" ]; then
    pm2 reload  "$ADMIN_DIR/ecosystem.admin.cjs" --update-env 2>/dev/null || \
    pm2 restart "$ADMIN_DIR/ecosystem.admin.cjs" --update-env 2>/dev/null || \
    pm2 start   "$ADMIN_DIR/ecosystem.admin.cjs" 2>/dev/null
    pm2 save 2>/dev/null || true
    echo -e "  ✅ Admin panel running on port 4000"
else
    echo -e "  ${RED}Admin panel not found — run install.sh first${NC}"
fi

pm2 save 2>/dev/null || true

# ── Summary ───────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "\n${BOLD}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deployment complete!${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e ""
echo -e "  📡  Main App:       ${BOLD}http://${SERVER_IP}:3000${NC}"
echo -e "  🎛️  Admin Panel:    ${BOLD}http://${SERVER_IP}:4000${NC}"
echo -e "  🔑  Admin Password: ${BOLD}Admin123@${NC}"
echo -e ""
echo -e "  💡 Verify: docker ps | pm2 status"
echo -e ""
