#!/bin/bash

set -e

echo "Building backend Docker image..."

cd /opt/flipbook-saas/backend

# Build image
docker build -t flipbook-backend:latest .

echo "Backend image built successfully!"
echo "Image: flipbook-backend:latest"

# Show images
docker images | grep flipbook-backend
