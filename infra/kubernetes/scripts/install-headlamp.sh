#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
HEADLAMP_CHART_VERSION="0.46.0"

for command_name in helm kubectl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "La commande requise '$command_name' est absente." >&2
    exit 1
  fi
done

kubectl get nodes
kubectl apply -f "$ROOT_DIR/infra/kubernetes/overlays/dev/namespace.yaml"
kubectl apply -f "$ROOT_DIR/infra/kubernetes/overlays/test/namespace.yaml"
kubectl apply -k "$ROOT_DIR/infra/kubernetes/headlamp"
helm repo add headlamp https://kubernetes-sigs.github.io/headlamp/ --force-update
helm repo update headlamp
helm upgrade --install headlamp headlamp/headlamp \
  --namespace headlamp \
  --version "$HEADLAMP_CHART_VERSION" \
  --values "$ROOT_DIR/infra/kubernetes/headlamp/values.yaml" \
  --wait \
  --timeout 5m
kubectl get service headlamp -n headlamp
