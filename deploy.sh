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

# --- 3. Clean up dangling images to save space ---
echo "Cleaning up dangling images..."
docker image prune -f 2>/dev/null || true

echo "Done! The base Docker Image is built and ready for the Admin Panel."
