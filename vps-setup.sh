#!/usr/bin/env bash
#
# Qaff Studio — VPS Initial Setup Script from GitHub
# This script prepares a fresh Ubuntu VPS and clones the private repo.
#
# Run on fresh VPS: curl -fsSL https://raw.githubusercontent.com/mahmoudmousa8/qaff-studio/main/vps-setup.sh | bash
#

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
NC="\033[0m"

REPO_URL="https://github.com/mahmoudmousa8/qaff-studio.git"
INSTALL_DIR="/opt/qaff-studio"

echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Qaff Studio — VPS Initial Setup${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}\n"

# 1. Update system & install Git
echo -e "${CYAN}[1/4] Updating system packages and installing Git...${NC}"
sudo apt-get update -qq
sudo apt-get install -y git curl unzip jq fail2ban
echo -e "  ✅ System ready"

# 2. Check SSH key for GitHub
echo -e "\n${CYAN}[2/4] Checking GitHub Access...${NC}"

if ! ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
    echo -e "${YELLOW}⚠️ You need a GitHub Deploy Key or Personal Access Token (PAT) for this private repository.${NC}"
    
    # Prompt for PAT if SSH fails
    echo -e "Please enter your GitHub Personal Access Token (PAT) with 'repo' scope:"
    read -rs GITHUB_TOKEN
    echo ""
    
    if [ -z "$GITHUB_TOKEN" ]; then
        echo -e "${RED}Token is required for a private repository. Exiting.${NC}"
        exit 1
    fi
    
    # Update URL to use HTTPS with token
    REPO_URL="https://${GITHUB_TOKEN}@github.com/mahmoudmousa8/qaff-studio.git"
    echo -e "  ✅ Using token authentication"
else
     echo -e "  ✅ SSH Key authenticated"
     REPO_URL="git@github.com:mahmoudmousa8/qaff-studio.git"
fi


# 3. Clone Repository
echo -e "\n${CYAN}[3/4] Cloning Qaff Studio Repository...${NC}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Directory $INSTALL_DIR already exists. Pulling latest instead...${NC}"
    cd "$INSTALL_DIR"
    git pull origin main
else
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$(whoami):$(whoami)" "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

echo -e "  ✅ Repository cloned successfully"

# 4. Trigger the main auto-installer
echo -e "\n${CYAN}[4/4] Starting the Qaff Auto-Installer...${NC}"

if [ -f "install.sh" ]; then
    chmod +x install.sh deploy.sh update.sh
    echo -e "${GREEN}Running install.sh... Please wait.${NC}\n"
    sudo ./install.sh
else
    echo -e "${RED}install.sh not found inside $INSTALL_DIR!${NC}"
    exit 1
fi

echo -e "\n${BOLD}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🎉 Qaff Studio is Installed and Ready!${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}\n"
