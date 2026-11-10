#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHART_VERSION="${PROMETHEUS_STACK_CHART_VERSION:-93.1.1}"
GRAFANA_SECRET_NAME="clichy-grafana-admin"
GRAFANA_CREDENTIALS_DIR="$HOME/.config/clichy"
GRAFANA_USER_FILE="$GRAFANA_CREDENTIALS_DIR/grafana-admin-user"
GRAFANA_PASSWORD_FILE="$GRAFANA_CREDENTIALS_DIR/grafana-admin-password"

for command_name in helm kubectl python3 openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "La commande requise '$command_name' est absente." >&2
    exit 1
  fi
done

ensure_helm_repo() {
  local name="$1"
  local url="$2"
  local configured_url

  configured_url="$(
    helm repo list --output json |
      python3 -c '
import json
import sys

repositories = json.load(sys.stdin)
name = sys.argv[1]
print(next((repo["url"] for repo in repositories if repo["name"] == name), ""))
' "$name"
  )"

  if [[ -z "$configured_url" ]]; then
    helm repo add "$name" "$url"
  elif [[ "$configured_url" != "$url" ]]; then
    echo "Le dépôt Helm '$name' pointe vers '$configured_url', pas '$url'." >&2
    echo "Inspectez sa configuration ; le script ne la remplacera pas." >&2
    exit 1
  fi
}

echo "Contexte Kubernetes : $(kubectl config current-context)"
kubectl get nodes
release_exists=false
if helm status prometheus-stack --namespace monitoring >/dev/null 2>&1; then
  release_exists=true
fi

if [[ "$release_exists" == true &&
  "${ALLOW_PROMETHEUS_UPGRADE:-false}" != "true" ]]; then
  echo "La release prometheus-stack existe déjà dans monitoring." >&2
  echo "Vérifiez ses valeurs avant une mise à niveau, puis relancez avec" >&2
  echo "ALLOW_PROMETHEUS_UPGRADE=true si vous confirmez le remplacement par" >&2
  echo "les valeurs versionnées dans infra/kubernetes/monitoring/helm-values.yaml." >&2
  exit 1
fi

if [[ "$release_exists" == true ]]; then
  echo "La release prometheus-stack sera mise à niveau vers chart $CHART_VERSION."
else
  echo "La stack kube-prometheus-stack $CHART_VERSION sera installée dans monitoring."
fi
read -r -p "Continuer sur le contexte Kubernetes affiché ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

if ! kubectl get namespace monitoring >/dev/null 2>&1; then
  kubectl create namespace monitoring
fi

existing_grafana_secret="$(
  kubectl get secret "$GRAFANA_SECRET_NAME" \
    --namespace monitoring \
    --ignore-not-found \
    --output=name
)"
if [[ -n "$existing_grafana_secret" ]]; then
  if ! kubectl get secret "$GRAFANA_SECRET_NAME" \
    --namespace monitoring \
    --output=json |
    python3 -c '
import json
import sys

data = json.load(sys.stdin).get("data", {})
sys.exit(0 if data.get("admin-user") and data.get("admin-password") else 1)
'; then
    echo "Le Secret $GRAFANA_SECRET_NAME existe mais ne contient pas les clés attendues." >&2
    echo "Inspectez-le manuellement ; le script ne le remplacera pas." >&2
    exit 1
  fi
elif [[ "$release_exists" == true &&
  "${ALLOW_GRAFANA_CREDENTIAL_UPDATE:-false}" != "true" ]]; then
  echo "Grafana est déjà installé sans le Secret $GRAFANA_SECRET_NAME." >&2
  echo "Créer et vérifier ce Secret manuellement, ou confirmer explicitement" >&2
  echo "la rotation du mot de passe avec ALLOW_GRAFANA_CREDENTIAL_UPDATE=true." >&2
  exit 1
else
  if [[ -L "$GRAFANA_USER_FILE" || -L "$GRAFANA_PASSWORD_FILE" ]]; then
    echo "Les fichiers locaux des identifiants Grafana ne doivent pas être des liens symboliques." >&2
    exit 1
  fi

  if [[ ! -e "$GRAFANA_USER_FILE" && ! -e "$GRAFANA_PASSWORD_FILE" ]]; then
    umask 077
    mkdir -p "$GRAFANA_CREDENTIALS_DIR"
    chmod 700 "$GRAFANA_CREDENTIALS_DIR"
    printf 'admin' >"$GRAFANA_USER_FILE"
    openssl rand -hex 32 | tr -d '\n' >"$GRAFANA_PASSWORD_FILE"
    chmod 600 "$GRAFANA_USER_FILE" "$GRAFANA_PASSWORD_FILE"
  elif [[ ! -s "$GRAFANA_USER_FILE" || ! -s "$GRAFANA_PASSWORD_FILE" ]]; then
    echo "Les fichiers locaux d'identifiants Grafana sont incomplets." >&2
    echo "Ils ne seront pas remplacés ; corrigez-les ou déplacez-les manuellement." >&2
    exit 1
  fi

  chmod 600 "$GRAFANA_USER_FILE" "$GRAFANA_PASSWORD_FILE"
  kubectl create secret generic "$GRAFANA_SECRET_NAME" \
    --namespace monitoring \
    --from-file=admin-user="$GRAFANA_USER_FILE" \
    --from-file=admin-password="$GRAFANA_PASSWORD_FILE"
fi

ensure_helm_repo prometheus-community \
  https://prometheus-community.github.io/helm-charts
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
if [[ -f "$GRAFANA_PASSWORD_FILE" ]]; then
  echo "Mot de passe Grafana initial conservé dans $GRAFANA_PASSWORD_FILE (mode 600)."
  echo "Le script n'affiche jamais sa valeur."
fi
