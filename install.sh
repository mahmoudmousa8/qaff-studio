#!/usr/bin/env bash
#
# Qaff Studio — Install Script (with Admin Master Panel)
# Ubuntu 22.04 / 24.04
# Run: chmod +x install.sh && sudo ./install.sh
#
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"
ADMIN_DIR="/opt/qaff-admin"

echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Qaff Studio + Admin Panel — Installer${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}\n"

# ════════════════════════════════════════════
# 1. Timezone
# ════════════════════════════════════════════
echo -e "${GREEN}[1/10]${NC} Setting timezone to Africa/Cairo..."
sudo timedatectl set-timezone Africa/Cairo 2>/dev/null || true
echo -e "  ✅ Timezone: $(timedatectl show --property=Timezone --value 2>/dev/null || echo 'Africa/Cairo')"

# ════════════════════════════════════════════
# 2. Kernel & Network Tuning for High Load
# ════════════════════════════════════════════
echo -e "\n${GREEN}[2/10]${NC} Applying High-Load Kernel & Network limits..."

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
ensure_min_sysctl "net.ipv4.tcp_rmem" "4096 87380 16777216"   # Fallback array strings don't parse well in GT, handled below instead.
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
echo "net.ipv4.tcp_rmem = 4096 87380 16777216" >> $TARGET_CONF
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
echo -e "  ✅ Kernel Limits and BBR Congestion Control configured"

# Setup Persistent NIC Tuning (txqueuelen, ethtool ring buffers / CPU queues)
cat << 'NIC_TUNE' > /tmp/qaff-nic-tune.sh
#!/bin/bash
MAIN_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
if [ -n "$MAIN_IFACE" ]; then
    # Increase transmit queue length
    ip link set "$MAIN_IFACE" txqueuelen 10000 2>/dev/null || true
    
    # Increase Ring Buffers to absorb bursts
    ethtool -G "$MAIN_IFACE" rx 4096 tx 4096 2>/dev/null || true
    
    # Scale NIC hardware queues to match CPU cores
    CPU=$(nproc)
    ethtool -L "$MAIN_IFACE" combined $CPU 2>/dev/null || \
    ethtool -L "$MAIN_IFACE" rx $CPU tx $CPU 2>/dev/null || true
fi
NIC_TUNE

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

echo -e "  ✅ Advanced NIC Queue and Ring Buffer Tuning configured"

# ════════════════════════════════════════════
# 3. System packages
# ════════════════════════════════════════════
echo -e "\n${GREEN}[3/10]${NC} Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y \
  curl wget unzip openssl \
  build-essential \
  sqlite3 ethtool \
  ffmpeg \
  2>/dev/null | grep -E "(installed|upgraded)" || true

if ! command -v ffmpeg &>/dev/null; then
  echo -e "  ${RED}ffmpeg install failed!${NC}" && exit 1
fi
echo -e "  ✅ ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"
echo -e "  ✅ System packages installed"

# ════════════════════════════════════════════
# 3. Node.js 20.x
# ════════════════════════════════════════════
echo -e "\n${GREEN}[3/9]${NC} Setting up Node.js 20.x..."

install_node20() {
  echo -e "  ${YELLOW}Installing Node.js 20.x via NodeSource...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | grep -E "(found|adding|Executing)" || true
  sudo apt-get install -y nodejs
  echo -e "  ✅ Node.js $(node -v)"
}

if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 20 ]; then
    echo -e "  ✅ Node.js $(node -v) — OK"
  else
    echo -e "  ${YELLOW}Node.js v${NODE_VER} found, upgrading to 20...${NC}"
    sudo apt-get remove -y nodejs nodejs-doc 2>/dev/null || true
    install_node20
  fi
else
  install_node20
fi
echo -e "  ✅ npm: $(npm -v)"

# ════════════════════════════════════════════
# 4. PM2 + tsx
# ════════════════════════════════════════════
echo -e "\n${GREEN}[4/9]${NC} Setting up PM2..."
if command -v pm2 &>/dev/null; then
  echo -e "  ✅ PM2 $(pm2 -v) already installed"
else
  sudo npm install -g pm2 2>&1 | tail -2
  echo -e "  ✅ PM2 $(pm2 -v) installed"
fi

if ! command -v tsx &>/dev/null; then
  sudo npm install -g tsx 2>&1 | tail -2
fi
echo -e "  ✅ tsx: $(tsx -v 2>/dev/null || echo 'installed')"

# ════════════════════════════════════════════
# 5. Docker Engine
# ════════════════════════════════════════════
echo -e "\n${GREEN}[5/9]${NC} Setting up Docker..."
if command -v docker &>/dev/null; then
  echo -e "  ✅ Docker $(docker --version | cut -d' ' -f3 | tr -d ',') already installed"
else
  echo -e "  ${YELLOW}Installing Docker Engine...${NC}"
  curl -fsSL https://get.docker.com | sudo bash 2>&1 | tail -5
  echo -e "  ✅ Docker installed"
fi

# Add current user to docker group
sudo usermod -aG docker "$(whoami)" 2>/dev/null || true
# Allow docker socket access for PM2 processes
sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
echo -e "  ✅ Docker socket ready"

# ════════════════════════════════════════════
# 6. .env Setup
# ════════════════════════════════════════════
echo -e "\n${GREEN}[6/9]${NC} Setting up .env..."
if [ -f "$ENV_FILE" ]; then
  echo -e "  ✅ .env already exists — keeping existing"
else
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo -e "  ✅ Created .env from .env.example"
fi

if grep -q "change-me-to-a-random-secure-string" "$ENV_FILE" 2>/dev/null; then
  NEW_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
  sed -i "s/change-me-to-a-random-secure-string/$NEW_SECRET/" "$ENV_FILE"
  echo -e "  ✅ SESSION_SECRET auto-generated"
fi

# ════════════════════════════════════════════
# 7. Directories + Firewall
# ════════════════════════════════════════════
echo -e "\n${GREEN}[7/9]${NC} Directories & Firewall..."
for dir in data data/videos data/upload data/download data/logs; do
  mkdir -p "$PROJECT_DIR/$dir"
done
sudo mkdir -p /var/log/qaff
sudo chown -R "$(whoami):$(whoami)" /var/log/qaff 2>/dev/null || true
chmod -R 755 "$PROJECT_DIR/data"
echo -e "  ✅ Directories created"

if command -v ufw &>/dev/null; then
  sudo ufw allow 22/tcp   2>/dev/null || true
  sudo ufw allow 3000/tcp 2>/dev/null || true
  sudo ufw allow 4000/tcp 2>/dev/null || true   # Admin Panel
  # Allow client ports range 31000–32999
  sudo ufw allow 31000:32999/tcp 2>/dev/null || true
  sudo ufw --force enable 2>/dev/null || true
  echo -e "  ✅ UFW: ports 22, 3000, 4000, 31000-32999 opened"
else
  echo -e "  ${YELLOW}UFW not found — skipping firewall setup${NC}"
fi

# ════════════════════════════════════════════
# 8. npm install + Prisma + Build (Main App)
# ════════════════════════════════════════════
echo -e "\n${GREEN}[8/9]${NC} Installing dependencies & building main app..."
cd "$PROJECT_DIR"

npm install --production=false 2>&1 | tail -3
echo -e "  ✅ npm install complete"

npx prisma generate 2>&1 | tail -2
npx prisma db push 2>&1 | tail -2
echo -e "  ✅ Database initialized"

if node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.adminUser.count().then(c => { process.exit(c > 0 ? 1 : 0); }).catch(() => process.exit(0));
" 2>/dev/null; then
  node scripts/set-admin-password.mjs Admin 2>/dev/null || true
  echo -e "  ✅ Default app password set: Admin"
else
  echo -e "  ✅ App admin password already set"
fi

sudo rm -rf "$PROJECT_DIR/.next"
npm run build 2>&1 | tail -5
echo -e "  ✅ Production build complete"

# Build Docker image
echo -e "\n  ${YELLOW}Building qaff-studio Docker image (this may take a few minutes)...${NC}"
docker build -t qaff-studio:latest "$PROJECT_DIR" 2>&1 | tail -5
echo -e "  ✅ Docker image qaff-studio:latest built"

# ════════════════════════════════════════════
# 9. Admin Panel Setup
# ════════════════════════════════════════════
echo -e "\n${GREEN}[9/9]${NC} Setting up Qaff Admin Panel..."

# Copy admin panel files to /opt/qaff-admin
sudo mkdir -p "$ADMIN_DIR"
sudo cp -r "$PROJECT_DIR/qaff-admin/." "$ADMIN_DIR/"
sudo chown -R "$(whoami):$(whoami)" "$ADMIN_DIR"
mkdir -p "$ADMIN_DIR/data/logs"

# Install admin panel dependencies
cd "$ADMIN_DIR"
sudo npm install --production 2>&1 | tail -3
echo -e "  ✅ Admin panel dependencies installed"
echo -e "  ✅ Admin panel ready at /opt/qaff-admin"

# ════════════════════════════════════════════
# Start Admin Panel via PM2
# ════════════════════════════════════════════
cd "$ADMIN_DIR"
echo -e "\n${GREEN}Starting Admin Panel via PM2...${NC}"
sudo pm2 delete qaff-admin 2>/dev/null || true
sudo pm2 start server.js --name "qaff-admin" 2>/dev/null || true
sudo pm2 save 2>/dev/null || true
echo -e "  ✅ Admin panel started on port 4000"
cd "$PROJECT_DIR"
# ════════════════════════════════════════════
# Done — user manages clients via Admin Panel
# ════════════════════════════════════════════
SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "\n${BOLD}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Installation & Tuning complete!${NC}"
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e ""
echo -e "  🎛️  Admin Panel:    ${BOLD}http://${SERVER_IP}:4000${NC}"
echo -e "  🔑  Admin Password: ${BOLD}Admin123@${NC}"
echo -e ""
echo -e "  💡 Create your first client from the Admin Panel!"
echo -e ""
MAIN_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1 2>/dev/null || echo "eth0")
echo -e "${CYAN}──────── System Limits Applied ────────${NC}"
echo -e "  • BBR Congestion: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo 'N/A')"
echo -e "  • somaxconn:      $(sysctl -n net.core.somaxconn 2>/dev/null || echo 'N/A')"
echo -e "  • file-max:       $(sysctl -n fs.file-max 2>/dev/null || echo 'N/A')"
echo -e "  • Open Files:     $(ulimit -n)"
echo -e "  • TX Queue Len:   $(ip link show $MAIN_IFACE 2>/dev/null | grep qlen | awk '{print $NF}' || echo 'N/A')"
echo -e "${CYAN}───────────────────────────────────────${NC}"
echo -e "  🔍 To rigorously verify system limits, you can run:"
echo -e "     ${BOLD}sysctl net.ipv4.tcp_congestion_control${NC}"
echo -e "     ${BOLD}ethtool -g $MAIN_IFACE${NC} (Check Ring Buffers)"
echo -e "     ${BOLD}ethtool -l $MAIN_IFACE${NC} (Check CPU Queues)"
echo -e "\n${BOLD}✅ All done!${NC}\n"
