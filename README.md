# Qaff Studio Streaming

Professional video streaming management system with YouTube compliance, automated scheduling, and system diagnostics.

---

## 🖥️ Local Development

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env

# 3. Initialize database
npx prisma generate
npx prisma db push

# 4. Start dev server
npm run dev
```

Open `http://localhost:3000`

---

## 🏗️ Production Build

```bash
# 1. Install + setup (same as above)
npm install
cp .env.example .env
npx prisma generate
npx prisma db push

# 2. Build production bundle
npx next build

# 3. Copy static assets into standalone
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

# 4. Run production server
PORT=3000 node .next/standalone/server.js
```

---

## 🚀 VPS Deployment (Ubuntu 24.04)

### Prerequisites

```bash
sudo apt update && sudo apt install -y nodejs npm ffmpeg wget curl
node -v   # Must be >= 18
```

> **Node < 18?** Install via NodeSource:
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
> sudo apt install -y nodejs
> ```

### Option A: Automated (Recommended)

```bash
# Upload to VPS
scp -r ./Stream user@YOUR_IP:/opt/qaff-studio

# SSH and run
ssh user@YOUR_IP
cd /opt/qaff-studio

chmod +x install.sh deploy.sh
./install.sh    # Deps → .env → dirs → DB → build
./deploy.sh     # Start services → health checks
```

### Option B: Manual

```bash
cd /opt/qaff-studio

npm install
cp .env.example .env
nano .env                     # Edit as needed

npx prisma generate
npx prisma db push
npx next build

# Copy static assets
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

# Start Stream Manager
cd mini-services/stream-manager
nohup npx tsx index.ts > /opt/qaff-studio/data/logs/stream-manager.log 2>&1 &

# Start Web App
cd /opt/qaff-studio
PORT=3000 node .next/standalone/server.js
```

### Option C: systemd (Production)

```bash
# Create service user
sudo useradd -r -s /bin/false qaff
sudo chown -R qaff:qaff /opt/qaff-studio

# Install services
sudo cp systemd/qaff-web.service /etc/systemd/system/
sudo cp systemd/qaff-stream-manager.service /etc/systemd/system/

# Enable (auto-start after reboot)
sudo systemctl daemon-reload
sudo systemctl enable qaff-stream-manager qaff-web
sudo systemctl start qaff-stream-manager
sudo systemctl start qaff-web
```

---

## 📂 Storage Paths

All paths are configured via environment variables. On first boot, directories are **auto-created** by the bootstrap system.

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_DATA_DIR` | `./data` | Root data directory |
| `VIDEOS_DIR` | `./data/videos` | Stored video files for streaming |
| `UPLOAD_DIR` | `./data/upload` | Temporary upload staging area |
| `DOWNLOAD_DIR` | `./data/download` | Downloaded files (e.g. from URL) |
| `LOGS_DIR` | `./data/logs` | Service log files |
| `DATABASE_URL` | `file:./data/app.db` | SQLite database |

### Folder Structure After Boot

```
data/
├── app.db            # SQLite database (auto-created by Prisma)
├── videos/           # Video files for streaming
│   └── *.mp4
├── upload/           # Upload staging
├── download/         # Downloaded files
└── logs/             # web.log, stream-manager.log
```

> **Security:** All file operations validate that resolved paths remain **within** the configured base directory using `path.resolve()` comparison, preventing path traversal attacks.

---

## 🎬 Streaming Modes

The stream manager uses **ffprobe** to analyze each video file before streaming. It automatically selects the best profile:

### Direct Copy Mode (Preferred)

**When:** Source file has H264 video codec AND AAC audio codec.

```
ffmpeg -re -stream_loop -1 -i video.mp4 -c copy -f flv rtmp://...
```

- ✅ Zero CPU usage for encoding
- ✅ Original quality preserved
- ✅ Instant start

### YouTube Transcode Mode

**When:** Source file has incompatible codecs (not H264 or not AAC).

```
ffmpeg -re -stream_loop -1 -i video.mp4 \
  -c:v libx264 -preset veryfast -b:v 4500k \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a aac -b:a 128k -ar 44100 \
  -f flv rtmp://...
```

| Setting | Value | Why |
|---------|-------|-----|
| `-c:v libx264` | H264 encoder | YouTube requirement |
| `-preset veryfast` | Fast encoding | Low CPU usage |
| `-b:v 4500k` | 4.5 Mbps video | 1080p quality |
| `-g 60` | GOP = fps × 2 | **2-second keyframes** (YouTube requires ≤ 4s) |
| `-keyint_min 60` | Min keyframe interval | Consistent keyframes |
| `-sc_threshold 0` | No scene change detection | Predictable keyframes |
| `-c:a aac` | AAC audio | YouTube requirement |
| `-b:a 128k` | 128 kbps audio | **Never zero** |
| `-ar 44100` | 44.1 kHz sample rate | Standard audio |

> **Probe endpoint:** `curl http://127.0.0.1:3002/probe?file=/path/to/video.mp4` — Shows what profile would be used.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./data/app.db` | SQLite connection string |
| `APP_DATA_DIR` | `./data` | Base data directory |
| `VIDEOS_DIR` | `./data/videos` | Video files storage |
| `UPLOAD_DIR` | `./data/upload` | Upload temp directory |
| `DOWNLOAD_DIR` | `./data/download` | Download directory |
| `LOGS_DIR` | `./data/logs` | Log files directory |
| `STREAM_MANAGER_URL` | `http://127.0.0.1:3002` | Stream manager internal URL |
| `STREAM_MANAGER_PORT` | `3002` | Stream manager port |
| `MAX_CONCURRENT_STREAMS` | `10` | Max parallel FFmpeg streams |
| `STAGGER_MS` | `1000` | Delay between stream starts (ms) |
| `PORT` | `3000` | Web app port |
| `NODE_ENV` | `production` | Environment mode |

---

## 🔧 Debug Commands

### Service Status
```bash
sudo systemctl status qaff-web
sudo systemctl status qaff-stream-manager
```

### View Logs
```bash
# systemd logs (live)
sudo journalctl -u qaff-web -f --no-pager
sudo journalctl -u qaff-stream-manager -f --no-pager

# File logs
tail -f /opt/qaff-studio/data/logs/web.log
tail -f /opt/qaff-studio/data/logs/stream-manager.log
```

### Restart Services
```bash
sudo systemctl restart qaff-stream-manager
sudo systemctl restart qaff-web
```

### Health Checks
```bash
# Web app alive?
curl http://127.0.0.1:3000/api

# Stream manager alive?
curl http://127.0.0.1:3002/health

# Full system diagnostics (JSON)
curl http://127.0.0.1:3000/api/diagnostics | python3 -m json.tool

# Storage info
curl http://127.0.0.1:3000/api/storage | python3 -m json.tool

# Reconcile stream states (fixes DB/manager mismatches)
curl http://127.0.0.1:3000/api/status | python3 -m json.tool

# Probe a video file (check what profile will be used)
curl "http://127.0.0.1:3002/probe?file=/opt/qaff-studio/data/videos/test.mp4"
```

### Database
```bash
npx prisma db push --force-reset   # Reset database
npx prisma studio                    # Open DB GUI
```

### Port Issues
```bash
sudo lsof -i :3000        # What's using port 3000?
sudo lsof -i :3002        # What's using port 3002?
sudo fuser -k 3000/tcp    # Kill process on port
sudo fuser -k 3002/tcp
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│  Qaff Studio Web App (Next.js)  :3000   │
│  ├─ React UI (slots, scheduling)        │
│  ├─ 20 API Routes                       │
│  ├─ Diagnostics Dashboard               │
│  ├─ Status Reconciliation (5s poll)     │
│  └─ Prisma (SQLite)                     │
└────────┬────────────────────────────────┘
         │ HTTP (127.0.0.1 only)
┌────────▼────────────────────────────────┐
│  Stream Manager  :3002 (internal)       │
│  ├─ FFmpeg process control              │
│  ├─ ffprobe codec detection             │
│  ├─ YouTube Transcode / Direct Copy     │
│  ├─ MAX_CONCURRENT_STREAMS limit        │
│  ├─ Staggered start queue               │
│  └─ Port guard (no duplicate process)   │
└─────────────────────────────────────────┘
```

### Ports

| Port | Service | Access |
|------|---------|--------|
| 3000 | Web App | **Public** (your VPS IP) |
| 3002 | Stream Manager | **Internal only** (127.0.0.1) |

---

## 📁 Project Files

```
qaff-studio/
├── .env.example              # Environment template
├── install.sh                # Automated installer
├── deploy.sh                 # Deployment script
├── README.md                 # This file
├── systemd/
│   ├── qaff-web.service      # Web app systemd unit
│   └── qaff-stream-manager.service
├── prisma/
│   └── schema.prisma
├── public/
│   └── logo.svg
├── mini-services/
│   └── stream-manager/
│       └── index.ts          # FFmpeg controller
└── src/
    ├── app/
    │   ├── page.tsx           # Main streaming UI
    │   ├── diagnostics/
    │   │   └── page.tsx       # System health dashboard
    │   └── api/
    │       ├── diagnostics/   # Health check API
    │       ├── storage/       # Disk usage API
    │       ├── status/        # State reconciliation
    │       ├── upload/        # File upload
    │       ├── download/      # URL download
    │       ├── videos/        # Video listing
    │       ├── folders/       # File management
    │       ├── logs/          # System logs
    │       ├── stats/         # Statistics
    │       ├── scheduler/     # Schedule runner
    │       └── slots/         # Stream management
    └── lib/
        ├── paths.ts           # Centralized path config
        ├── ensure-dirs.ts     # Directory bootstrap
        └── db.ts              # Prisma singleton
```

---

## License

Qaff Media © All rights reserved — For Sales: [01202406944](https://wa.me/201202406944)
