#!/bin/bash

set -e

echo "Building frontend Docker image..."

cd /opt/flipbook-saas/frontend

# Build image
docker build -t flipbook-frontend:latest .

echo "Frontend image built successfully!"
echo "Image: flipbook-frontend:latest"

# Show images
docker images | grep flipbook-frontend
