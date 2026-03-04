#!/usr/bin/env bash
set -e

# --- 1. Detect Project Name ---
PROJECT_NAME=""
# Try from package.json first
if [ -f "package.json" ]; then
    PROJECT_NAME=$(grep -m 1 '"name"' package.json | cut -d '"' -f 4 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g')
fi
# Fallback to current directory name
if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g')
fi
# Final fallback
if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME="auto-app"
fi

IMAGE_NAME="${PROJECT_NAME}:latest"
CONTAINER_NAME="${PROJECT_NAME}_container"

echo "Detected Project Name: $PROJECT_NAME"
echo "Building Image: $IMAGE_NAME"

# --- 2. Build Docker Image ---
docker build -t "$IMAGE_NAME" .

# Make sure qaff-studio:latest always explicitly points to whatever this image is
# because the Admin Panel hard-checks for "qaff-studio:latest" when creating clients
docker tag "$IMAGE_NAME" qaff-studio:latest 2>/dev/null || true

# --- 3. Generate docker-compose.yml dynamically ---
echo "Generating docker-compose.yml..."
cat <<EOF > docker-compose.yml
services:
  app:
    image: ${IMAGE_NAME}
    container_name: ${CONTAINER_NAME}
    restart: unless-stopped
    ports:
      - "3000:3000"
EOF

# --- 4. Stop & Remove old container ---
echo "Stopping and removing old container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# --- 5. Run new container via standard Docker (or you can use docker compose up -d) ---
echo "Running new container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p 3000:3000 \
    "$IMAGE_NAME"

echo "Done! Application is running on port 3000."
