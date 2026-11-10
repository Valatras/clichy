#!/usr/bin/env bash
set -euo pipefail

if command -v helm >/dev/null 2>&1; then
  helm version --short
  exit 0
fi

if [[ ! -r /etc/os-release ]] || ! command -v apt-get >/dev/null 2>&1; then
  echo "Ce script installe Helm uniquement sur Debian ou Ubuntu." >&2
  echo "Consultez https://helm.sh/docs/intro/install/ pour les autres systèmes." >&2
  exit 1
fi

source /etc/os-release
if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
  echo "Ce script installe Helm uniquement sur Debian ou Ubuntu." >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]] && ! command -v sudo >/dev/null 2>&1; then
  echo "Exécutez ce script avec un compte sudo ou en tant que root." >&2
  exit 1
fi

for command_name in apt-get curl dpkg gpg; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "La commande requise '$command_name' est absente." >&2
    exit 1
  fi
done

run_as_root() {
  if [[ "$EUID" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

if [[ "$EUID" -ne 0 ]]; then
  sudo -v
fi

key_path="/usr/share/keyrings/helm.gpg"
source_path="/etc/apt/sources.list.d/helm-stable-debian.list"
architecture="$(dpkg --print-architecture)"
source_line="deb [arch=${architecture} signed-by=${key_path}] https://baltocdn.com/helm/stable/debian/ all main"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

curl -fsSL https://baltocdn.com/helm/signing.asc |
  gpg --dearmor >"$temporary_directory/helm.gpg"

if run_as_root test -e "$key_path"; then
  if ! run_as_root cmp -s "$temporary_directory/helm.gpg" "$key_path"; then
    echo "$key_path existe avec une clé différente ; il ne sera pas remplacé." >&2
    exit 1
  fi
fi

if run_as_root test -e "$source_path"; then
  if ! run_as_root grep -Fqx "$source_line" "$source_path"; then
    echo "$source_path existe avec une configuration différente." >&2
    echo "Inspectez-la manuellement ; elle ne sera pas remplacée." >&2
    exit 1
  fi
fi

echo "Ce script configure le dépôt APT officiel de Helm et installe le paquet helm."
read -r -p "Continuer ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

if ! run_as_root test -e "$key_path"; then
  run_as_root install -D -m 0644 "$temporary_directory/helm.gpg" "$key_path"
fi

if ! run_as_root test -e "$source_path"; then
  printf '%s\n' "$source_line" |
    run_as_root tee "$source_path" >/dev/null
fi

run_as_root apt-get update
run_as_root apt-get install -y helm

helm version --short
