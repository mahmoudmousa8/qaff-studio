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

echo -e "\n${CYAN}[2/6] Applying High-Load Kernel & Network limits (Auto-Tuning)...${NC}"

cat << 'EOF' > /tmp/qaff-tune.sh
#!/bin/bash
TARGET_CONF="/etc/sysctl.d/99-qaff-tuning.conf"
rm -f $TARGET_CONF
touch $TARGET_CONF

ensure_min_sysctl() {
    local key=$1
    local req=$2
    local cur=$(sysctl -n $key 2>/dev/null || echo 0)
    if [ "$cur" -ge "$req" ] 2>/dev/null; then
        echo "$key = $cur" >> $TARGET_CONF
    else
        echo "$key = $req" >> $TARGET_CONF
    fi
}

ensure_min_sysctl "fs.file-max" 2097152
ensure_min_sysctl "net.core.somaxconn" 65535
ensure_min_sysctl "net.ipv4.tcp_max_syn_backlog" 65535
ensure_min_sysctl "net.core.netdev_max_backlog" 300000
ensure_min_sysctl "net.ipv4.tcp_fin_timeout" 10
ensure_min_sysctl "net.ipv4.tcp_tw_reuse" 1
ensure_min_sysctl "net.ipv4.tcp_keepalive_time" 600
ensure_min_sysctl "net.ipv4.tcp_keepalive_intvl" 60
ensure_min_sysctl "net.ipv4.tcp_keepalive_probes" 10
ensure_min_sysctl "net.ipv4.tcp_rmem" "4096 87380 16777216"
ensure_min_sysctl "net.ipv4.tcp_max_tw_buckets" 2000000
ensure_min_sysctl "net.core.rmem_max" 16777216
ensure_min_sysctl "net.core.wmem_max" 16777216

# Ensure conntrack module is loaded before applying sysctl
modprobe nf_conntrack 2>/dev/null || true
ensure_min_sysctl "net.netfilter.nf_conntrack_max" 2000000

# Overwrite string/multi-value parameters safely
echo "net.ipv4.ip_local_port_range = 1024 65535" >> $TARGET_CONF
echo "net.core.default_qdisc = fq" >> $TARGET_CONF
echo "net.ipv4.tcp_congestion_control = bbr" >> $TARGET_CONF
echo "net.ipv4.tcp_wmem = 4096 65536 16777216" >> $TARGET_CONF
echo "net.netfilter.nf_conntrack_tcp_timeout_established = 7200" >> $TARGET_CONF
echo "net.netfilter.nf_conntrack_tcp_timeout_time_wait = 10" >> $TARGET_CONF

sysctl -p $TARGET_CONF >/dev/null 2>&1

# Setup security limits
mkdir -p /etc/security/limits.d
cat << 'LIMITS' > /etc/security/limits.d/99-qaff.conf
* soft nofile 2097152
* hard nofile 2097152
* soft nproc 2097152
* hard nproc 2097152
root soft nofile 2097152
root hard nofile 2097152
LIMITS

# Setup systemd global limits
mkdir -p /etc/systemd/system.conf.d/
cat << 'SYSCONF' > /etc/systemd/system.conf.d/limits.conf
[Manager]
DefaultLimitNOFILE=2097152
DefaultLimitNPROC=2097152
SYSCONF
systemctl daemon-reload
EOF

sudo bash /tmp/qaff-tune.sh
echo -e "  ✅ Kernel Limits and BBR Congestion Control customized."

# Setup Persistent NIC Tuning (txqueuelen, ethtool ring buffers / CPU queues)
cat << 'NIC_TUNE' > /tmp/qaff-nic-tune.sh
#!/bin/bash
MAIN_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
if [ -n "$MAIN_IFACE" ]; then
    ip link set "$MAIN_IFACE" txqueuelen 10000 2>/dev/null || true
    ethtool -G "$MAIN_IFACE" rx 4096 tx 4096 2>/dev/null || true
    CPU=$(nproc)
    ethtool -L "$MAIN_IFACE" combined $CPU 2>/dev/null || \
    ethtool -L "$MAIN_IFACE" rx $CPU tx $CPU 2>/dev/null || true
fi
NIC_TUNE

sudo apt-get install -y ethtool >/dev/null 2>&1 || true
sudo mv /tmp/qaff-nic-tune.sh /usr/local/bin/qaff-nic-tune.sh
sudo chmod +x /usr/local/bin/qaff-nic-tune.sh

cat << 'NIC_SERVICE' > /tmp/qaff-nic-tune.service
[Unit]
Description=Qaff Studio NIC Advanced Tuning
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/qaff-nic-tune.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
NIC_SERVICE

sudo mv /tmp/qaff-nic-tune.service /etc/systemd/system/qaff-nic-tune.service
sudo systemctl daemon-reload 2>/dev/null || true
sudo systemctl enable qaff-nic-tune.service 2>/dev/null || true
sudo systemctl start qaff-nic-tune.service 2>/dev/null || true

echo -e "  ✅ Advanced NIC Queue and Ring Buffer Tuning configured."

echo -e "\n${CYAN}[3/6] Installing new dependencies...${NC}"
sudo npm install --production=false 2>&1 | tail -3
echo -e "  ✅ Dependencies installed."

echo -e "\n${CYAN}[4/6] Building the Next.js application...${NC}"
# Kill any stuck next build process
pkill -f "next build" 2>/dev/null || true
sleep 1
# Remove the entire .next folder to prevent any root-owned cache/lock permission issues
sudo rm -rf "$PROJECT_DIR/.next"
# Build Next.js
npm run build 2>&1 | tail -5
echo -e "  ✅ Production build ready."

echo -e "\n${CYAN}[5/6] Updating Admin Master Panel files...${NC}"
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

echo -e "\n${CYAN}[6/6] Restarting services (zero client downtime)...${NC}"
# Rebuild Docker image and start main app using deploy script
if [ -f "./deploy.sh" ]; then
    chmod +x ./deploy.sh
    ./deploy.sh
else
    echo -e "  ${YELLOW}deploy.sh not found. Could not automatically restart main app.${NC}"
fi

# Reload admin panel safely
if sudo pm2 show qaff-admin &>/dev/null; then
    sudo pm2 reload qaff-admin --update-env 2>/dev/null || sudo pm2 restart qaff-admin 2>/dev/null || true
else
    cd "$ADMIN_DIR"
    sudo pm2 start server.js --name "qaff-admin" 2>/dev/null || true
    cd "$PROJECT_DIR"
fi

sudo pm2 save 2>/dev/null || true

MAIN_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1 2>/dev/null || echo "eth0")
SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "\n${BOLD}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🎉 Update & System Tuning Complete!${NC}"
echo -e "  Client streams were NOT interrupted."
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e ""
echo -e "  🎛️  Admin Panel:  ${BOLD}http://${SERVER_IP}:4000${NC}"
echo -e "  📡  Main App:     ${BOLD}http://${SERVER_IP}:3000${NC}"
echo -e ""
echo -e "${CYAN}──────── System Limits Applied ────────${NC}"
echo -e "  • BBR Congestion: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo 'N/A')"
echo -e "  • somaxconn:      $(sysctl -n net.core.somaxconn 2>/dev/null || echo 'N/A')"
echo -e "  • file-max:       $(sysctl -n fs.file-max 2>/dev/null || echo 'N/A')"
echo -e "  • Open Files:     $(ulimit -n)"
echo -e "  • TX Queue Len:   $(ip link show $MAIN_IFACE 2>/dev/null | grep qlen | awk '{print $NF}' || echo 'N/A')"
echo -e "${CYAN}───────────────────────────────────────${NC}"
