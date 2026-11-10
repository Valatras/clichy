#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "La commande requise 'kubectl' est absente." >&2
  exit 1
fi

echo "Contexte Kubernetes : $(kubectl config current-context)"
kubectl get nodes
if ! kubectl get crd helmchartconfigs.helm.cattle.io >/dev/null 2>&1; then
  echo "Le CRD HelmChartConfig de K3s est absent ; le chart Traefik K3s n'est pas prêt." >&2
  exit 1
fi
manifest="$ROOT_DIR/infra/kubernetes/traefik-lan/helmchartconfig.yaml"
desired_values="$(
  kubectl apply --dry-run=client -f "$manifest" \
    -o jsonpath='{.spec.valuesContent}'
)"
existing_config="$(
  kubectl get helmchartconfig traefik \
    --namespace kube-system \
    --ignore-not-found \
    --output=name
)"
if [[ -n "$existing_config" ]]; then
  existing_values="$(
    kubectl get helmchartconfig traefik \
      --namespace kube-system \
      -o jsonpath='{.spec.valuesContent}'
  )"
  if [[ "$existing_values" != "$desired_values" ]]; then
    echo "Un HelmChartConfig Traefik différent existe déjà." >&2
    echo "Fusionnez manuellement les ports grafana/headlamp avec ses valeurs ; le script ne l'écrasera pas." >&2
    exit 1
  fi
  echo "Le HelmChartConfig Traefik correspond déjà aux valeurs du dépôt."
else
  echo "Les ports Traefik 3000/4466 seront publiés sur les interfaces du nœud."
fi
echo "Limitez leur accès avec UFW sur tailscale0 ; ce script ne modifie pas UFW."
read -r -p "Vérifier/appliquer cette configuration sur le contexte affiché ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

if [[ -z "$existing_config" ]]; then
  kubectl apply -f "$manifest"
fi
kubectl rollout status deployment/traefik -n kube-system --timeout=300s
kubectl get service traefik -n kube-system
