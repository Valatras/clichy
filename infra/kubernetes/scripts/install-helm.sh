#!/usr/bin/env bash
set -euo pipefail

if command -v helm >/dev/null 2>&1; then
  helm version --short
  exit 0
fi

if [[ ! -f /etc/debian_version ]] || ! command -v apt-get >/dev/null 2>&1; then
  echo "Ce script installe Helm uniquement sur Debian ou Ubuntu." >&2
  echo "Consultez https://helm.sh/docs/intro/install/ pour les autres systèmes." >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1 && [[ "$EUID" -ne 0 ]]; then
  echo "Exécutez ce script avec un compte sudo ou en tant que root." >&2
  exit 1
fi

curl -fsSL -o get_helm.sh \
  https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4

chmod 700 get_helm.sh

./get_helm.sh

helm version --short
