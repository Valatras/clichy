#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART_VERSION="${PROMETHEUS_STACK_CHART_VERSION:-93.1.1}"

for command_name in helm kubectl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "La commande requise '$command_name' est absente." >&2
    exit 1
  fi
done

kubectl get nodes
if helm status prometheus-stack --namespace monitoring >/dev/null 2>&1 &&
  [[ "${ALLOW_PROMETHEUS_UPGRADE:-false}" != "true" ]]; then
  echo "La release prometheus-stack existe déjà dans monitoring." >&2
  echo "Vérifiez ses valeurs avant une mise à niveau, puis relancez avec" >&2
  echo "ALLOW_PROMETHEUS_UPGRADE=true si vous confirmez le remplacement par" >&2
  echo "les valeurs versionnées dans infra/kubernetes/monitoring/helm-values.yaml." >&2
  exit 1
fi

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts \
  --force-update
helm repo update prometheus-community

helm_args=(
  upgrade --install prometheus-stack
  prometheus-community/kube-prometheus-stack
  --namespace monitoring
  --create-namespace
  --version "$CHART_VERSION"
  --values "$ROOT_DIR/infra/kubernetes/monitoring/helm-values.yaml"
  --wait
  --timeout 10m
)

helm "${helm_args[@]}"
kubectl wait --for=condition=Established --timeout=120s \
  crd/servicemonitors.monitoring.coreos.com \
  crd/prometheusrules.monitoring.coreos.com
kubectl apply -k "$ROOT_DIR/infra/kubernetes/monitoring"
kubectl get pods,servicemonitors,prometheusrules -n monitoring
