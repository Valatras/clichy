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

run_as_root() {
  if [[ "$EUID" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_as_root apt-get update
run_as_root apt-get install -y apt-transport-https ca-certificates curl gpg
run_as_root install -d -m 0755 /usr/share/keyrings
curl -fsSL https://baltocdn.com/helm/signing.asc |
  gpg --dearmor |
  run_as_root tee /usr/share/keyrings/helm.gpg >/dev/null
run_as_root chmod 0644 /usr/share/keyrings/helm.gpg
printf '%s\n' \
  'deb [signed-by=/usr/share/keyrings/helm.gpg] https://baltocdn.com/helm/stable/debian/ all main' |
  run_as_root tee /etc/apt/sources.list.d/helm-stable-debian.list >/dev/null
run_as_root apt-get update
run_as_root apt-get install -y helm

helm version --short
