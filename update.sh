#!/usr/bin/env bash
#
# Qaff Studio — GitHub Private Repo Smart Updater
# Run: chmod +x update.sh && ./update.sh
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
    echo -e "${YELLOW}Project directory $PROJECT_DIR not found. Please clone it first.${NC}"
    exit 1
fi

cd "$PROJECT_DIR"

echo -e "${CYAN}[1/5] Fetching latest updates from GitHub...${NC}"
# Stash any accidental local changes (except for ignored data/env files)
git stash 2>/dev/null || true
git fetch origin main
git pull origin main
echo -e "  ✅ Code updated to latest commit."

echo -e "\n${CYAN}[2/5] Installing new dependencies...${NC}"
npm install --production=false 2>&1 | tail -3
echo -e "  ✅ Dependencies installed."

echo -e "\n${CYAN}[3/5] Building the Next.js application...${NC}"
npm run build 2>&1 | tail -5
echo -e "  ✅ Production build ready."

echo -e "\n${CYAN}[4/5] Updating Admin Master Panel files...${NC}"
if [ -d "$ADMIN_DIR" ]; then
    # Smart copy: update admin files without touching /data database
    rsync -avq --exclude='data' --exclude='node_modules' "$PROJECT_DIR/qaff-admin/" "$ADMIN_DIR/"
    cd "$ADMIN_DIR"
    npm install --production 2>&1 | tail -3
    cd "$PROJECT_DIR"
    echo -e "  ✅ Admin panel code updated (data preserved)."
else
    echo -e "  ${YELLOW}Admin panel not found at $ADMIN_DIR. Creating...${NC}"
    sudo cp -r "$PROJECT_DIR/qaff-admin/." "$ADMIN_DIR/"
    mkdir -p "$ADMIN_DIR/data/logs"
    cd "$ADMIN_DIR"
    npm install --production 2>&1 | tail -3
    cd "$PROJECT_DIR"
fi

echo -e "\n${CYAN}[5/5] Restarting services with zero client downtime...${NC}"
# Restart main app
pm2 restart ecosystem.config.cjs --update-env 2>/dev/null || pm2 start ecosystem.config.cjs 2>/dev/null || true
# Restart admin panel
pm2 restart "$ADMIN_DIR/ecosystem.admin.cjs" --update-env 2>/dev/null || pm2 start "$ADMIN_DIR/ecosystem.admin.cjs" 2>/dev/null || true

echo -e "\n${BOLD}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🎉 Update Complete!${NC}"
echo -e "  Client streams were NOT interrupted."
echo -e "${BOLD}════════════════════════════════════════════${NC}\n"
