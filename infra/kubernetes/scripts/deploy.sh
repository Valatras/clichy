#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/infra/kubernetes/scripts"

usage() {
  echo "Usage: $0 test|prod sha-<40-character-git-sha>" >&2
  exit 2
}

die() {
  echo "Error: $*" >&2
  exit 1
}

[[ $# -eq 2 ]] || usage

ENVIRONMENT="$1"
IMAGE_TAG="$2"

case "$ENVIRONMENT" in
  test|prod) ;;
  *) usage ;;
esac

if [[ ! "$IMAGE_TAG" =~ ^sha-[[:xdigit:]]{40}$ ]]; then
  echo "Error: image tag must be sha- followed by exactly 40 hexadecimal characters." >&2
  exit 2
fi

for command_name in git kubectl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    die "Required command '$command_name' was not found in PATH."
  fi
done

checked_out_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)" ||
  die "Could not determine the checked-out Git commit."
if [[ "$IMAGE_TAG" != "sha-${checked_out_sha}" ]]; then
  die "Image tag '$IMAGE_TAG' must match the checked-out commit sha-${checked_out_sha}."
fi

NAMESPACE="clichy-${ENVIRONMENT}"
OVERLAY_DIR="$ROOT_DIR/infra/kubernetes/overlays/$ENVIRONMENT"

context="$(kubectl config current-context)" ||
  die "Could not read the current Kubernetes context."
node_names="$(kubectl get nodes \
  --output=jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')" ||
  die "Could not read Kubernetes nodes from context '$context'."
if [[ "$node_names" != "valtask" ]]; then
  printf "Refusing to deploy %s: expected the single node valtask, got:\n%s\n" \
    "$ENVIRONMENT" "$node_names" >&2
  exit 1
fi

echo "Deploy $IMAGE_TAG to $NAMESPACE (context $context)."
if [[ "${CLICHY_DEPLOY_CONFIRM:-}" == "yes" ]]; then
  echo "Using explicit non-interactive deployment confirmation."
else
  if ! read -r -p "Continue? [y/N] " answer; then
    die "Could not read deployment confirmation."
  fi
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
  fi
fi

if [[ "$ENVIRONMENT" == "prod" ]]; then
  kubectl apply --filename="$OVERLAY_DIR/namespace.yaml" ||
    die "Could not create or verify namespace $NAMESPACE."

  require_secret_keys() {
    local secret_name="$1"
    shift
    local secret_resource
    local secret_keys
    local key

    secret_resource="$(kubectl get secret "$secret_name" \
      --namespace="$NAMESPACE" \
      --ignore-not-found \
      --output=name)" ||
      die "Could not inspect Secret '$secret_name' in namespace '$NAMESPACE'; verify Kubernetes access."
    if [[ -z "$secret_resource" ]]; then
      die "Required Secret '$secret_name' is missing from namespace '$NAMESPACE'. Provision it before deploying."
    fi

    secret_keys="$(kubectl get secret "$secret_name" \
      --namespace="$NAMESPACE" \
      --output='go-template={{range $key, $value := .data}}{{printf "%s\n" $key}}{{end}}')" ||
      die "Could not read keys from Secret '$secret_name' in namespace '$NAMESPACE'; verify Kubernetes access."

    for key in "$@"; do
      if ! grep -Fxq -- "$key" <<<"$secret_keys"; then
        die "Required key '$key' is missing from Secret '$secret_name' in namespace '$NAMESPACE'. Provision it before deploying."
      fi
    done
  }

  require_secret_keys clichy-prod-secrets \
    BETTER_AUTH_SECRET DATABASE_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
  require_secret_keys ghcr-pull-secret .dockerconfigjson

  pull_secret_type="$(kubectl get secret ghcr-pull-secret \
    --namespace="$NAMESPACE" \
    --output='jsonpath={.type}')" ||
    die "Could not verify the type of Secret 'ghcr-pull-secret' in namespace '$NAMESPACE'."
  if [[ "$pull_secret_type" != "kubernetes.io/dockerconfigjson" ]]; then
    die "Secret 'ghcr-pull-secret' in namespace '$NAMESPACE' must have type kubernetes.io/dockerconfigjson."
  fi
fi

if ! "$SCRIPT_DIR/migrate.sh" "$ENVIRONMENT" deploy; then
  die "Database migration failed for $ENVIRONMENT; application manifests were not applied."
fi

render_dir="$(mktemp -d "$ROOT_DIR/infra/kubernetes/.deploy.XXXXXX")" ||
  die "Could not create a temporary Kustomize render directory."
rendered_file="$render_dir/rendered.yaml"
cleanup_render() {
  rm -f -- "$render_dir/kustomization.yaml" "$rendered_file"
  rmdir -- "$render_dir"
}
trap cleanup_render EXIT

cat >"$render_dir/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../overlays/$ENVIRONMENT
images:
  - name: ghcr.io/valatras/clichy-server
    newTag: $IMAGE_TAG
  - name: ghcr.io/valatras/clichy-web
    newTag: $IMAGE_TAG
  - name: ghcr.io/valatras/clichy-worker
    newTag: $IMAGE_TAG
EOF

kubectl kustomize "$render_dir" >"$rendered_file" ||
  die "Kustomize failed to render the $ENVIRONMENT overlay."

if grep -Fq 'REPLACE_WITH_TESTED_GIT_SHA' "$rendered_file"; then
  die "Rendered manifests still contain an image SHA placeholder."
fi
for image in clichy-server clichy-web clichy-worker; do
  expected_image="        image: ghcr.io/valatras/${image}:${IMAGE_TAG}"
  image_count="$(grep -Fxc -- "$expected_image" "$rendered_file" || true)"
  if [[ "$image_count" != "1" ]]; then
    die "Rendered manifests must contain exactly one $image image tagged $IMAGE_TAG."
  fi
done

kubectl apply --filename="$rendered_file" ||
  die "Applying the $ENVIRONMENT manifests failed."
kubectl rollout status deployment/clichy-server \
  --namespace="$NAMESPACE" --timeout=300s ||
  die "Deployment clichy-server did not roll out successfully in $NAMESPACE."
kubectl rollout status deployment/clichy-web \
  --namespace="$NAMESPACE" --timeout=300s ||
  die "Deployment clichy-web did not roll out successfully in $NAMESPACE."
kubectl rollout status deployment/clichy-worker \
  --namespace="$NAMESPACE" --timeout=300s ||
  die "Deployment clichy-worker did not roll out successfully in $NAMESPACE."
kubectl get deployments,pods,pvc,ingress \
  --namespace="$NAMESPACE" --output=wide ||
  die "Could not display deployment resources in $NAMESPACE."
