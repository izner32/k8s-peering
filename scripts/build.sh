#!/bin/bash

# Build script for Luxor Peering Operator
# This script builds both the server and operator Docker images

set -e

echo "========================================="
echo "Building Luxor Peering Operator"
echo "========================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Build server image
echo -e "${BLUE}Building peering server image...${NC}"
docker build -f Dockerfile.server -t peering-server:latest .
echo -e "${GREEN}✓ Server image built successfully${NC}"

# Build operator image
echo -e "${BLUE}Building operator image...${NC}"
docker build -f Dockerfile.operator -t peering-operator:latest .
echo -e "${GREEN}✓ Operator image built successfully${NC}"

echo ""
echo "========================================="
echo "Build completed successfully!"
echo "========================================="
echo ""
echo "Images built:"
echo "  - peering-server:latest"
echo "  - peering-operator:latest"
echo ""
echo "Next steps:"
echo "  For minikube: make load-minikube"
echo "  For kind:     make load-kind"
echo "  For install:  make install"
