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

TARGET_CONF="/etc/sysctl.d/99-qaff-tuning.conf"
sudo rm -f $TARGET_CONF
sudo touch $TARGET_CONF

ensure_min_sysctl() {
    local key=$1
    local req=$2
    local cur=$(sysctl -n $key 2>/dev/null || echo 0)
    if [ "$cur" -ge "$req" ] 2>/dev/null; then
        echo "$key = $cur" | sudo tee -a $TARGET_CONF >/dev/null
    else
        echo "$key = $req" | sudo tee -a $TARGET_CONF >/dev/null
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
sudo modprobe nf_conntrack 2>/dev/null || true
ensure_min_sysctl "net.netfilter.nf_conntrack_max" 2000000

# Overwrite string/multi-value parameters safely
echo "net.ipv4.ip_local_port_range = 1024 65535" | sudo tee -a $TARGET_CONF >/dev/null
echo "net.core.default_qdisc = fq" | sudo tee -a $TARGET_CONF >/dev/null
echo "net.ipv4.tcp_congestion_control = bbr" | sudo tee -a $TARGET_CONF >/dev/null
echo "net.ipv4.tcp_wmem = 4096 65536 16777216" | sudo tee -a $TARGET_CONF >/dev/null
echo "net.netfilter.nf_conntrack_tcp_timeout_established = 7200" | sudo tee -a $TARGET_CONF >/dev/null
echo "net.netfilter.nf_conntrack_tcp_timeout_time_wait = 10" | sudo tee -a $TARGET_CONF >/dev/null

sudo sysctl -p $TARGET_CONF >/dev/null 2>&1

# Setup security limits
sudo mkdir -p /etc/security/limits.d
sudo bash -c "cat << 'LIMITS' > /etc/security/limits.d/99-qaff.conf
* soft nofile 2097152
* hard nofile 2097152
* soft nproc 2097152
* hard nproc 2097152
root soft nofile 2097152
root hard nofile 2097152
LIMITS"

# Setup systemd global limits
sudo mkdir -p /etc/systemd/system.conf.d/
sudo bash -c "cat << 'SYSCONF' > /etc/systemd/system.conf.d/limits.conf
[Manager]
DefaultLimitNOFILE=2097152
DefaultLimitNPROC=2097152
SYSCONF"

sudo systemctl daemon-reload
echo -e "  ✅ Kernel Limits and BBR Congestion Control customized."

# Cleanup previous aggressive NIC tuning (fixed Hostinger bufferbloat issue)
sudo systemctl stop qaff-nic-tune.service 2>/dev/null || true
sudo systemctl disable qaff-nic-tune.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/qaff-nic-tune.service /usr/local/bin/qaff-nic-tune.sh /tmp/qaff-nic-tune.sh
sudo systemctl daemon-reload 2>/dev/null || true
MAIN_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
if [ -n "$MAIN_IFACE" ]; then
    sudo ip link set "$MAIN_IFACE" txqueuelen 1000 2>/dev/null || true
fi
echo -e "  ✅ Reverted excessive NIC Queue to default (Fixed RTMP Jitter / Bufferbloat)."

echo -e "\n${CYAN}[3/6] Installing new dependencies...${NC}"
sudo npm install --production=false 2>&1 | tail -3
echo -e "  ✅ Dependencies installed."

# Ensure primary bind-mount root exists
sudo mkdir -p /opt/qaff-data
sudo chown -R 1000:1000 /opt/qaff-data
sudo chmod 755 /opt/qaff-data

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


# ── Auto-mount additional disk if present and not yet mounted ──
EXTRA_DISK=""
for DEV in /dev/sdb /dev/sdc /dev/vdb /dev/vdc; do
  if [ -b "$DEV" ] && ! lsblk -no MOUNTPOINT "$DEV" | grep -q '/'; then
    EXTRA_DISK="$DEV"
    break
  fi
done
if [ -n "$EXTRA_DISK" ]; then
  MOUNT_POINT="/mnt/storage"
  FSTYPE=$(blkid -o value -s TYPE "$EXTRA_DISK" 2>/dev/null || echo "")
  [ -z "$FSTYPE" ] && sudo mkfs.ext4 -F "$EXTRA_DISK"
  sudo mkdir -p "$MOUNT_POINT"
  sudo mount "$EXTRA_DISK" "$MOUNT_POINT" 2>/dev/null || true
  DISK_UUID=$(blkid -s UUID -o value "$EXTRA_DISK")
  if [ -n "$DISK_UUID" ] && ! grep -q "$DISK_UUID" /etc/fstab; then
    echo "UUID=${DISK_UUID}  ${MOUNT_POINT}  ext4  defaults,nofail  0  2" | sudo tee -a /etc/fstab > /dev/null
  fi
  sudo mkdir -p "${MOUNT_POINT}/qaff-data"
  sudo chown -R "$(whoami):$(whoami)" "${MOUNT_POINT}/qaff-data"
  echo -e "  ✅ Extra disk mounted at ${MOUNT_POINT}"
fi

# ── Admin Panel: strictly on port 4000 via PM2 ──────────────────
echo -e "  Restarting Admin Panel on port 4000..."

# Kill ANYTHING on port 4000 first (safety guard — no other process allowed there)
PORT4000_PID=$(lsof -ti:4000 2>/dev/null || true)
if [ -n "$PORT4000_PID" ]; then
    echo "  Killing stale process(es) on port 4000: $PORT4000_PID"
    kill -9 $PORT4000_PID 2>/dev/null || true
    sleep 1
fi

if sudo pm2 show qaff-admin &>/dev/null; then
    sudo pm2 reload qaff-admin --update-env 2>/dev/null || sudo pm2 restart qaff-admin 2>/dev/null || true
else
    cd "$ADMIN_DIR"
    sudo pm2 start server.js --name "qaff-admin" 2>/dev/null || true
    cd "$PROJECT_DIR"
fi

# Ensure PM2 survives reboots
PM2_STARTUP_CMD=$(sudo pm2 startup systemd -u root --hp /root 2>/dev/null | grep "sudo env" | grep -v "^\[" || true)
if [ -n "$PM2_STARTUP_CMD" ]; then eval "$PM2_STARTUP_CMD" 2>/dev/null || true; fi


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
