# Peering Operator

Get up and running with the Peering Operator

## Prerequisites

- Kubernetes cluster (minikube, kind, or any k8s)
- kubectl installed and configured
- Docker installed

```bash
# For minikube users
minikube start --cpus=4 --memory=4096 --driver=docker
```

## Step 1: Build Images

```bash
# Step 1: Build both images
make build

# Step 2: For minikube users
make load-minikube

# For kind users
make load-kind
```

## Step 2: Install Operator

```bash
make install
```

This will:
- Install the CRD
- Create RBAC resources
- Deploy the operator

## Step 3: Deploy PeeringServer 

```bash
make deploy
```

## Step 4: Watch It Work

```bash
# Watch pods being created
kubectl get pods -l app=peering-small -w

# View peering logs (in another terminal)
kubectl logs -f peering-small-0
```

Expected output:
```
[INFO] Pinging 3 peer(s)...
[INFO] ✓ Pinged peering-small-0.peering-small-headless.default.svc.cluster.local:8080 -> Response: pong
[INFO] ✓ Pinged peering-small-1.peering-small-headless.default.svc.cluster.local:8080 -> Response: pong
[INFO] ✓ Pinged peering-small-2.peering-small-headless.default.svc.cluster.local:8080 -> Response: pong
```

## Try Scaling

```bash
# Scale up to 5 replicas
kubectl patch peeringserver peering-small --type=merge -p '{"spec":{"replicas":5}}'

# Watch the new pods join
kubectl logs -f peering-small-0
```

Configuration updates automatically without pod restarts!

## Cleanup

```bash
make clean
```

## Troubleshooting

### Pods not starting?

```bash
kubectl describe pod <pod-name>
```

### Operator not working?

```bash
kubectl logs deployment/peering-operator
```

---
