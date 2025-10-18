#!/bin/bash

# Deploy script for Luxor Peering Operator
# This script deploys the operator and CRD to Kubernetes

set -e

echo "========================================="
echo "Deploying Luxor Peering Operator"
echo "========================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "Error: kubectl is not installed"
    exit 1
fi

# Install CRD
echo -e "${BLUE}Installing CRD...${NC}"
kubectl apply -f k8s/crd.yaml
echo -e "${GREEN}✓ CRD installed${NC}"

# Wait for CRD to be established
echo -e "${BLUE}Waiting for CRD to be established...${NC}"
kubectl wait --for condition=established --timeout=60s crd/peeringservers.luxor.io
echo -e "${GREEN}✓ CRD established${NC}"

# Install RBAC
echo -e "${BLUE}Installing RBAC...${NC}"
kubectl apply -f k8s/operator-rbac.yaml
echo -e "${GREEN}✓ RBAC installed${NC}"

# Deploy operator
echo -e "${BLUE}Deploying operator...${NC}"
kubectl apply -f k8s/operator-deployment.yaml
echo -e "${GREEN}✓ Operator deployed${NC}"

# Wait for operator to be ready
echo -e "${BLUE}Waiting for operator to be ready...${NC}"
kubectl wait --for=condition=available --timeout=120s deployment/peering-operator
echo -e "${GREEN}✓ Operator is ready${NC}"

echo ""
echo "========================================="
echo "Deployment completed successfully!"
echo "========================================="
echo ""
echo "Check operator logs:"
echo "  kubectl logs -f deployment/peering-operator"
echo ""
echo "Deploy an example PeeringServer:"
echo "  kubectl apply -f k8s/examples/peering-server-small.yaml"
