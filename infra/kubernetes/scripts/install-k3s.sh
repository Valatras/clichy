#!/usr/bin/env bash
set -euo pipefail

K3S_VERSION="${K3S_VERSION:-v1.37.2+k3s1}"
KUBECONFIG_PATH="${KUBECONFIG_PATH:-$HOME/.kube/config-k3s}"

if [[ "$EUID" -eq 0 ]]; then
  echo "Exécutez ce script avec le compte utilisateur qui possédera kubectl, pas avec sudo." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Impossible d'identifier le système d'exploitation." >&2
  exit 1
fi

source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "Ce script est prévu pour Ubuntu Server 24.04 LTS." >&2
  exit 1
fi

for command_name in curl sudo systemctl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "La commande requise '$command_name' est absente." >&2
    exit 1
  fi
done

sudo -v

if sudo systemctl cat k3s.service >/dev/null 2>&1; then
  if ! sudo systemctl is-active --quiet k3s.service; then
    echo "K3s est installé mais n'est pas actif." >&2
    echo "Inspectez 'sudo systemctl status k3s' avant de le démarrer." >&2
    exit 1
  fi
  echo "K3s est déjà installé et actif ; aucune réinstallation ne sera faite."
else
  echo "Cette opération installe K3s ${K3S_VERSION} et active son service systemd."
  echo "Elle installe aussi les composants K3s par défaut, dont Traefik et local-path."
  echo "Aucune règle de pare-feu ni configuration SSH ne sera modifiée."
  read -r -p "Installer K3s sur cet hôte ? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Opération annulée."
    exit 1
  fi

  curl -sfL https://get.k3s.io |
    sudo env INSTALL_K3S_VERSION="$K3S_VERSION" sh -
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl est introuvable après l'installation de K3s." >&2
  echo "Vérifiez que /usr/local/bin est dans le PATH de cet utilisateur." >&2
  exit 1
fi

if [[ -e "$KUBECONFIG_PATH" || -L "$KUBECONFIG_PATH" ]]; then
  echo "Le fichier $KUBECONFIG_PATH existe déjà ; il ne sera pas remplacé."
  if ! KUBECONFIG="$KUBECONFIG_PATH" kubectl get nodes; then
    echo "Le kubeconfig existant ne permet pas de joindre ce cluster." >&2
    echo "Inspectez-le et choisissez un autre KUBECONFIG_PATH si nécessaire." >&2
    exit 1
  fi
else
  kubeconfig_directory="$(dirname "$KUBECONFIG_PATH")"
  if [[ ! -d "$kubeconfig_directory" ]]; then
    (umask 077; mkdir -p "$kubeconfig_directory")
  elif [[ ! -O "$kubeconfig_directory" || ! -w "$kubeconfig_directory" ]]; then
    echo "Le répertoire $kubeconfig_directory doit appartenir à l'utilisateur courant et être accessible en écriture." >&2
    exit 1
  fi

  sudo install -o "$(id -u)" -g "$(id -g)" -m 0600 \
    /etc/rancher/k3s/k3s.yaml "$KUBECONFIG_PATH"
fi

export KUBECONFIG="$KUBECONFIG_PATH"
kubectl wait --for=condition=Ready node --all --timeout=180s
kubectl get nodes -o wide
echo "KUBECONFIG=$KUBECONFIG_PATH"
