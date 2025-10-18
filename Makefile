.PHONY: help build-server build-operator build install deploy clean test

# Default target
help:
	@echo "Luxor Peering Operator - Make targets:"
	@echo ""
	@echo "  build              - Build all Docker images"
	@echo "  build-server       - Build peering server image"
	@echo "  build-operator     - Build operator image"
	@echo "  install            - Install CRD and deploy operator"
	@echo "  deploy             - Deploy example PeeringServer"
	@echo "  clean              - Remove all resources"
	@echo "  test               - Run test deployment"
	@echo "  logs-operator      - View operator logs"
	@echo "  logs-server        - View server logs (small example)"
	@echo ""

# Build targets
build: build-server build-operator

build-server:
	@echo "Building peering server image..."
	docker build -f Dockerfile.server -t peering-server:latest .
	@echo "Server image built successfully"

build-operator:
	@echo "Building operator image..."
	docker build -f Dockerfile.operator -t peering-operator:latest .
	@echo "Operator image built successfully"

# Load images into minikube (if using minikube)
load-minikube:
	@echo "Loading images into minikube..."
	minikube image load peering-server:latest
	minikube image load peering-operator:latest
	@echo "Images loaded into minikube"

# Load images into kind (if using kind)
load-kind:
	@echo "Loading images into kind..."
	kind load docker-image peering-server:latest
	kind load docker-image peering-operator:latest
	@echo "Images loaded into kind"

# Installation targets
install:
	@echo "Installing CRD..."
	kubectl apply -f k8s/crd.yaml
	@echo "Deploying operator..."
	kubectl apply -f k8s/operator-rbac.yaml
	kubectl apply -f k8s/operator-deployment.yaml
	@echo "Waiting for operator to be ready..."
	kubectl wait --for=condition=available --timeout=60s deployment/peering-operator
	@echo "Installation complete!"

# Deploy example
deploy:
	@echo "Deploying example PeeringServer..."
	kubectl apply -f k8s/examples/peering-server-small.yaml
	@echo "Waiting for operator to create resources (this may take a few seconds)..."
	@sleep 5
	@echo "Waiting for StatefulSet to be created..."
	@bash -c 'for i in {1..30}; do kubectl get statefulset peering-small 2>/dev/null && break || sleep 2; done'
	@echo "Waiting for pods to be ready..."
	kubectl wait --for=condition=ready --timeout=120s pod -l app=peering-small
	@echo "Deployment complete!"

# Cleanup targets
clean:
	@echo "Cleaning up resources..."
	-kubectl delete peeringserver --all
	-kubectl delete -f k8s/operator-deployment.yaml
	-kubectl delete -f k8s/operator-rbac.yaml
	-kubectl delete -f k8s/crd.yaml
	@echo "Cleanup complete!"

# Testing targets
test: build install deploy
	@echo "Running tests..."
	@echo "Checking pods..."
	kubectl get pods -l app=peering-small
	@echo ""
	@echo "Checking PeeringServer status..."
	kubectl get peeringserver peering-small
	@echo ""
	@echo "Viewing logs from peering-small-0..."
	kubectl logs peering-small-0 --tail=20

# Log viewing
logs-operator:
	kubectl logs -f deployment/peering-operator

logs-server:
	kubectl logs -f peering-small-0

# Status check
status:
	@echo "=== Operator Status ==="
	kubectl get deployment peering-operator
	@echo ""
	@echo "=== PeeringServers ==="
	kubectl get peeringserver
	@echo ""
	@echo "=== Pods ==="
	kubectl get pods -l managed-by=peering-operator
	@echo ""
	@echo "=== Services ==="
	kubectl get svc -l managed-by=peering-operator
	@echo ""
	@echo "=== ConfigMaps ==="
	kubectl get configmap -l managed-by=peering-operator
