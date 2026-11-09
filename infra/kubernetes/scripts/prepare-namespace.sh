#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

usage() {
  echo "Usage: $0 dev|test" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage

case "$1" in
  dev|test) ENVIRONMENT="$1" ;;
  *) usage ;;
esac

NAMESPACE="clichy-${ENVIRONMENT}"
DATABASE="clichy_${ENVIRONMENT}"
SECRET_DIR="$HOME/.config/clichy"
SECRET_FILE="$SECRET_DIR/${ENVIRONMENT}-secrets.env"

for command_name in kubectl python3 openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "La commande requise '$command_name' est absente." >&2
    exit 1
  fi
done

context="$(kubectl config current-context)"
echo "Contexte Kubernetes : $context"
kubectl get nodes
read -r -p "Préparer les secrets de $NAMESPACE sur ce cluster ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

kubectl apply -f "$ROOT_DIR/infra/kubernetes/overlays/$ENVIRONMENT/namespace.yaml"

umask 077
mkdir -p "$SECRET_DIR"
chmod 700 "$SECRET_DIR"

if [[ ! -f "$SECRET_FILE" ]]; then
  read -r -p "Mot de passe PostgreSQL pour $DATABASE : " -s postgres_password
  printf '\n'
  if [[ -z "$postgres_password" ]]; then
    echo "Le mot de passe PostgreSQL ne peut pas être vide." >&2
    exit 1
  fi

  encoded_password="$(
    printf '%s' "$postgres_password" |
      python3 -c 'import sys; from urllib.parse import quote; print(quote(sys.stdin.read(), safe=""))'
  )"
  auth_secret="$(openssl rand -base64 32)"
  cat >"$SECRET_FILE" <<EOF
DATABASE_URL=postgresql://clichy:${encoded_password}@clichy-postgres:5432/${DATABASE}?schema=public
POSTGRES_DB=${DATABASE}
POSTGRES_USER=clichy
POSTGRES_PASSWORD=${postgres_password}
BETTER_AUTH_SECRET=${auth_secret}
EOF
  chmod 600 "$SECRET_FILE"
  unset postgres_password encoded_password auth_secret
else
  chmod 600 "$SECRET_FILE"
fi

for key in DATABASE_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD BETTER_AUTH_SECRET; do
  if ! grep -Eq "^${key}=.+" "$SECRET_FILE"; then
    echo "La clé $key est absente ou vide dans $SECRET_FILE." >&2
    exit 1
  fi
done

kubectl create secret generic clichy-server-secrets \
  --namespace="$NAMESPACE" \
  --from-env-file="$SECRET_FILE" \
  --dry-run=client -o yaml |
  kubectl apply -f -

read -r -p "Nom d'utilisateur GitHub pour lire GHCR : " ghcr_username
read -r -s -p "Jeton GitHub avec read:packages : " ghcr_token
printf '\n'
if [[ -z "$ghcr_username" || -z "$ghcr_token" ]]; then
  echo "Le nom d'utilisateur et le jeton GHCR sont requis." >&2
  exit 1
fi

printf '%s' "$ghcr_token" |
  GHCR_USERNAME="$ghcr_username" python3 -c '
import base64
import json
import os
import sys

username = os.environ["GHCR_USERNAME"]
token = sys.stdin.read()
auth = base64.b64encode(f"{username}:{token}".encode()).decode()
json.dump({"auths": {"ghcr.io": {
    "username": username,
    "password": token,
    "auth": auth,
}}}, sys.stdout)
' |
  kubectl create secret generic ghcr-pull-secret \
    --namespace="$NAMESPACE" \
    --type=kubernetes.io/dockerconfigjson \
    --from-file=.dockerconfigjson=/dev/stdin \
    --dry-run=client -o yaml |
  kubectl apply -f -

unset ghcr_token
kubectl apply --namespace="$NAMESPACE" \
  -f "$ROOT_DIR/infra/kubernetes/base/postgres-statefulset.yaml"
kubectl rollout status statefulset/clichy-postgres \
  --namespace="$NAMESPACE" \
  --timeout=300s
echo "Namespace $NAMESPACE prêt. Fichier local : $SECRET_FILE"
