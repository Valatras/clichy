#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

for command_name in kubectl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "La commande requise '$command_name' est absente." >&2
    exit 1
  fi
done

echo "Contexte Kubernetes : $(kubectl config current-context)"
kubectl get nodes
read -r -p "Ajouter les ports Traefik 3000 et 4466 sur ce cluster ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

kubectl apply -f "$ROOT_DIR/infra/kubernetes/traefik-lan/helmchartconfig.yaml"
kubectl rollout status deployment/traefik -n kube-system --timeout=300s
kubectl get service traefik -n kube-system
