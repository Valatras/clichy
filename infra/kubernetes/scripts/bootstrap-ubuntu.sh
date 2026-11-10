#!/usr/bin/env bash
set -euo pipefail

if [[ ! -r /etc/os-release ]]; then
  echo "Impossible d'identifier le système d'exploitation." >&2
  exit 1
fi

source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "Ce script est prévu pour Ubuntu Server 24.04 LTS." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "apt-get est requis pour installer les utilitaires." >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]] && ! command -v sudo >/dev/null 2>&1; then
  echo "Installez sudo ou exécutez ce script avec les privilèges root." >&2
  exit 1
fi

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

packages=(
  ca-certificates
  curl
  git
  gnupg
  jq
  openssl
  python3
  tar
  ufw
)
missing_packages=()

for package in "${packages[@]}"; do
  if ! dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null |
    grep -qx installed; then
    missing_packages+=("$package")
  fi
done

if [[ ${#missing_packages[@]} -eq 0 ]]; then
  echo "Les utilitaires requis sont déjà installés."
  exit 0
fi

printf 'Ce script va installer les paquets Ubuntu suivants : %s\n' \
  "${missing_packages[*]}"
echo "Il ne met pas Ubuntu à niveau, n'active pas UFW et ne modifie pas SSH."
read -r -p "Continuer ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

run_as_root apt-get update
run_as_root apt-get install -y --no-install-recommends "${missing_packages[@]}"
echo "Utilitaires installés. UFW reste dans son état précédent."
