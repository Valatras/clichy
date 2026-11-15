#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="$(<"$(dirname -- "${BASH_SOURCE[0]}")/operator-version")"
MANIFEST="https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/v${VERSION}/releases/cnpg-${VERSION}.yaml"

for command_name in kubectl python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command '$command_name' was not found in PATH." >&2
    exit 1
  fi
done

server_minor="$(kubectl version -o json | python3 -c '
import json
import sys

version = json.load(sys.stdin)["serverVersion"]["minor"].rstrip("+")
if not version.isdigit():
    raise SystemExit("Unable to parse Kubernetes server minor version")
print(int(version))
')"

case "$server_minor" in
  34|35|36)
    echo "Kubernetes 1.$server_minor is in the CNPG 1.30 supported matrix."
    ;;
  37)
    echo "Kubernetes 1.37 is tested but not officially supported by CNPG 1.30." >&2
    if [[ "${CNPG_ALLOW_TESTED_UNSUPPORTED_K8S:-}" != "1" ]]; then
      echo "Set CNPG_ALLOW_TESTED_UNSUPPORTED_K8S=1 to continue knowingly." >&2
      exit 2
    fi
    ;;
  *)
    echo "Kubernetes 1.$server_minor is outside the CNPG 1.30 tested matrix." >&2
    exit 2
    ;;
esac

existing_deployment="$(kubectl get deployment cnpg-controller-manager \
  --namespace cnpg-system --ignore-not-found --output=name)"
if [[ -n "$existing_deployment" ]]; then
  existing_image="$(kubectl get deployment cnpg-controller-manager \
    --namespace cnpg-system \
    --output='jsonpath={.spec.template.spec.containers[?(@.name=="manager")].image}')"
  if [[ "$existing_image" == *":${VERSION}" ]]; then
    echo "CloudNativePG $VERSION is already installed; leaving it unchanged."
    kubectl rollout status deployment/cnpg-controller-manager \
      --namespace cnpg-system --timeout=300s
    exit 0
  fi
  echo "A different CNPG operator image is already installed: $existing_image" >&2
  echo "Inspect and upgrade that installation explicitly; this script will not replace it." >&2
  exit 2
fi

existing_crd="$(kubectl get crd clusters.postgresql.cnpg.io \
  --ignore-not-found --output=name)"
if [[ -n "$existing_crd" ]]; then
  echo "CNPG CRDs already exist but the expected operator Deployment was not found." >&2
  echo "Inspect the existing installation before adding another operator." >&2
  exit 2
fi

echo "Installing CloudNativePG $VERSION from its versioned official manifest."
kubectl apply --server-side --filename="$MANIFEST"
kubectl wait --for=condition=Established --timeout=300s \
  crd/clusters.postgresql.cnpg.io
kubectl rollout status deployment/cnpg-controller-manager \
  --namespace cnpg-system --timeout=300s
kubectl get deployment,pods --namespace cnpg-system -o wide
