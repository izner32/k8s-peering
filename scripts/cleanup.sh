#!/bin/bash

# Cleanup script for Luxor Peering Operator
# This script removes all deployed resources

set -e

echo "========================================="
echo "Cleaning up Luxor Peering Operator"
echo "========================================="

# Colors for output
RED='\033[0;31m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Warning
echo -e "${RED}WARNING: This will delete all PeeringServer instances and the operator!${NC}"
read -p "Are you sure? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cleanup cancelled"
    exit 0
fi

# Delete all PeeringServer instances
echo -e "${BLUE}Deleting all PeeringServer instances...${NC}"
kubectl delete peeringserver --all --ignore-not-found=true
echo -e "${GREEN}✓ PeeringServer instances deleted${NC}"

# Wait for resources to be cleaned up
echo -e "${BLUE}Waiting for resources to be cleaned up...${NC}"
sleep 5

# Delete operator
echo -e "${BLUE}Deleting operator...${NC}"
kubectl delete -f k8s/operator-deployment.yaml --ignore-not-found=true
echo -e "${GREEN}✓ Operator deleted${NC}"

# Delete RBAC
echo -e "${BLUE}Deleting RBAC...${NC}"
kubectl delete -f k8s/operator-rbac.yaml --ignore-not-found=true
echo -e "${GREEN}✓ RBAC deleted${NC}"

# Delete CRD
echo -e "${BLUE}Deleting CRD...${NC}"
kubectl delete -f k8s/crd.yaml --ignore-not-found=true
echo -e "${GREEN}✓ CRD deleted${NC}"

echo ""
echo "========================================="
echo "Cleanup completed successfully!"
echo "========================================="
