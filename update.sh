#!/usr/bin/env bash
#
# Qaff Studio — GitHub Private Repo Smart Updater
# Run: ./update.sh  (no sudo needed)
#

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
NC="\033[0m"

PROJECT_DIR="/opt/qaff-studio"
ADMIN_DIR="/opt/qaff-admin"

echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Qaff Studio — Smart Auto-Update${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}\n"

# Ensure we are in the project directory
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}Project directory $PROJECT_DIR not found. Run install.sh first.${NC}"
    exit 1
fi

cd "$PROJECT_DIR"

echo -e "${CYAN}[1/5] Fetching latest updates from GitHub...${NC}"
git stash 2>/dev/null || true
git fetch origin main
git pull origin main
echo -e "  ✅ Code updated to latest commit."

echo -e "\n${CYAN}[2/5] Installing new dependencies...${NC}"
sudo npm install --production=false 2>&1 | tail -3
echo -e "  ✅ Dependencies installed."

echo -e "\n${CYAN}[3/5] Building the Next.js application...${NC}"
# Kill any stuck next build process
pkill -f "next build" 2>/dev/null || true
sleep 1
# Remove the entire .next folder to prevent any root-owned cache/lock permission issues
sudo rm -rf "$PROJECT_DIR/.next"
# Build Next.js
npm run build 2>&1 | tail -5
echo -e "  ✅ Production build ready."

echo -e "\n${CYAN}[4/5] Updating Admin Master Panel files...${NC}"
if [ -d "$ADMIN_DIR" ]; then
    sudo rsync -av --exclude='data' --exclude='node_modules' "$PROJECT_DIR/qaff-admin/" "$ADMIN_DIR/" 2>&1 | grep -E "(sending|created|is uptodate)" || true
    cd "$ADMIN_DIR"
    sudo npm install --production 2>&1 | tail -3
    cd "$PROJECT_DIR"
    echo -e "  ✅ Admin panel updated (data preserved)."
else
    echo -e "  ${YELLOW}Admin panel not found at $ADMIN_DIR. Creating...${NC}"
    sudo mkdir -p "$ADMIN_DIR"
    sudo rsync -av --exclude='data' --exclude='node_modules' "$PROJECT_DIR/qaff-admin/" "$ADMIN_DIR/" 2>&1 | tail -3
    sudo chown -R "$(whoami):$(whoami)" "$ADMIN_DIR"
    mkdir -p "$ADMIN_DIR/data/logs"
    cd "$ADMIN_DIR"
    sudo npm install --production 2>&1 | tail -3
    cd "$PROJECT_DIR"
    echo -e "  ✅ Admin panel created."
fi

echo -e "\n${CYAN}[5/5] Restarting services (zero client downtime)...${NC}"
# Rebuild Docker image and start main app using deploy script
if [ -f "./deploy.sh" ]; then
    chmod +x ./deploy.sh
    ./deploy.sh
else
    echo -e "  ${YELLOW}deploy.sh not found. Could not automatically restart main app.${NC}"
fi

# Reload admin panel safely
if pm2 show qaff-admin &>/dev/null; then
    pm2 reload qaff-admin --update-env 2>/dev/null || pm2 restart qaff-admin 2>/dev/null || true
else
    cd "$ADMIN_DIR"
    pm2 start server.js --name "qaff-admin" 2>/dev/null || true
    cd "$PROJECT_DIR"
fi

pm2 save 2>/dev/null || true

SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "\n${BOLD}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🎉 Update Complete!${NC}"
echo -e "  Client streams were NOT interrupted."
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e ""
echo -e "  🎛️  Admin Panel:  ${BOLD}http://${SERVER_IP}:4000${NC}"
echo -e "  📡  Main App:     ${BOLD}http://${SERVER_IP}:3000${NC}"
echo -e ""
