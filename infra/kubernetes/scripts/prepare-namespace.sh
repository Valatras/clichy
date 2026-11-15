#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

usage() {
  echo "Usage: $0 dev|test|prod" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage

case "$1" in
  dev|test|prod) ENVIRONMENT="$1" ;;
  *) usage ;;
esac

NAMESPACE="clichy-${ENVIRONMENT}"
DATABASE="clichy_${ENVIRONMENT}"
APP_SECRET_NAME="clichy-server-secrets"
if [[ "$ENVIRONMENT" == "prod" ]]; then
  APP_SECRET_NAME="clichy-prod-secrets"
fi
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

if [[ "$ENVIRONMENT" == "prod" ]]; then
  for command_name in sudo mountpoint; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      echo "La commande requise '$command_name' est absente." >&2
      exit 1
    fi
  done

  node_names="$(kubectl get nodes \
    --output=jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')"
  if [[ "$node_names" != "valtask" ]]; then
    printf "Refusing to prepare Prod: expected the single node valtask, got:\n%s\n" \
      "$node_names" >&2
    exit 1
  fi

  if ! mountpoint --quiet /srv/clichy; then
    echo "Prod storage requires /srv/clichy to be a mounted filesystem." >&2
    exit 1
  fi

fi

if ! kubectl get crd clusters.postgresql.cnpg.io >/dev/null 2>&1; then
  echo "CNPG CRD missing. Install the pinned operator first with infra/kubernetes/cnpg/install-operator.sh." >&2
  exit 1
fi
if ! kubectl rollout status deployment/cnpg-controller-manager \
  --namespace=cnpg-system --timeout=300s; then
  echo "CNPG operator is not Ready; no environment preparation was started." >&2
  exit 1
fi

if [[ -L "$SECRET_FILE" ]]; then
  echo "$SECRET_FILE est un lien symbolique ; il ne sera pas utilisé." >&2
  exit 1
fi

if [[ -f "$SECRET_FILE" ]]; then
  echo "Le fichier existant $SECRET_FILE sera conservé localement."
  echo "Ses valeurs seront appliquées aux Secrets Kubernetes de $NAMESPACE."
else
  echo "Le script créera un fichier de secrets protégé dans $SECRET_DIR."
fi
echo "Il créera ou mettra à jour les Secrets applicatifs/GHCR et PostgreSQL dans $NAMESPACE."
if [[ "$ENVIRONMENT" == "prod" ]]; then
  echo "Il préparera les nouveaux PV CNPG sous /srv/clichy/k3s-storage/prod/postgres-cnpg-{1,2}, sans toucher à l'ancien PostgreSQL."
fi
read -r -p "Préparer les secrets de $NAMESPACE sur ce cluster ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

if [[ "$ENVIRONMENT" == "prod" ]]; then
  sudo -v
  for directory in photos redis postgres-cnpg-1 postgres-cnpg-2; do
    path="/srv/clichy/k3s-storage/prod/$directory"
    sudo mkdir -p -- "$path"
    if [[ -L "$path" || ! -d "$path" ]]; then
      echo "Prod storage path '$path' must be a real directory, not a symlink." >&2
      exit 1
    fi
    if [[ "$directory" == postgres-cnpg-* ]]; then
      # CNPG's PostgreSQL image runs as UID/GID 26. Only initialize empty paths;
      # never recursively change ownership of existing data.
      if [[ -z "$(sudo find "$path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
        sudo chown 26:26 -- "$path"
        sudo chmod 0700 -- "$path"
      elif [[ "$(sudo stat -c '%u' -- "$path")" != "26" ]] ||
        [[ -n "$(sudo find "$path" -xdev ! -uid 26 -print -quit)" ]]; then
        echo "CNPG storage '$path' contains files not owned by UID 26; refusing to change ownership." >&2
        exit 1
      else
        sudo chmod 0700 -- "$path"
      fi
    elif [[ -z "$(sudo find "$path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      sudo chown root:1000 -- "$path"
      sudo chmod 2770 -- "$path"
    else
      echo "Preserving existing contents and permissions in $path."
    fi
  done
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
DATABASE_URL=postgresql://clichy:${encoded_password}@clichy-postgres-rw:5432/${DATABASE}?schema=public
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

# Existing local secret files still name the removed StatefulSet Service. Change
# only that hostname; retain the configured username, password and database.
EXPECTED_NAMESPACE="$NAMESPACE" python3 - "$SECRET_FILE" <<'PY'
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import os
import sys
import tempfile

path = Path(sys.argv[1])
lines = path.read_text().splitlines()
updated = []
found = False
for line in lines:
    if line.startswith("DATABASE_URL="):
        found = True
        key, raw_url = line.split("=", 1)
        parsed = urlsplit(raw_url)
        old_hosts = {"clichy-postgres",
                     f"clichy-postgres.{os.environ['EXPECTED_NAMESPACE']}.svc.cluster.local"}
        if parsed.hostname in old_hosts:
            userinfo = parsed.netloc.rsplit("@", 1)[0] + "@" if "@" in parsed.netloc else ""
            port = f":{parsed.port}" if parsed.port else ""
            raw_url = urlunsplit((parsed.scheme, userinfo + "clichy-postgres-rw" + port,
                                  parsed.path, parsed.query, parsed.fragment))
        elif parsed.hostname != "clichy-postgres-rw":
            raise SystemExit("DATABASE_URL must target the Clichy CNPG -rw Service.")
        line = f"{key}={raw_url}"
    updated.append(line)
if not found:
    raise SystemExit("DATABASE_URL is missing from the local secrets file.")
fd, temp_name = tempfile.mkstemp(prefix=".secrets.", dir=path.parent, text=True)
with os.fdopen(fd, "w") as output:
    output.write("\n".join(updated) + "\n")
os.chmod(temp_name, 0o600)
os.replace(temp_name, path)
PY

for key in DATABASE_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD BETTER_AUTH_SECRET; do
  if ! grep -Eq "^${key}=.+" "$SECRET_FILE"; then
    echo "La clé $key est absente ou vide dans $SECRET_FILE." >&2
    exit 1
  fi
done

if ! EXPECTED_DATABASE="$DATABASE" \
  python3 - "$SECRET_FILE" <<'PY'
from pathlib import Path
from urllib.parse import unquote, urlsplit
import os
import sys

values = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key] = value

try:
    url = urlsplit(values["DATABASE_URL"])
    database = unquote(url.path.lstrip("/"))
    valid = (
        url.scheme in {"postgres", "postgresql"}
        and url.hostname == "clichy-postgres-rw"
        and url.port == 5432
        and database == os.environ["EXPECTED_DATABASE"]
        and values["POSTGRES_DB"] == os.environ["EXPECTED_DATABASE"]
        and unquote(url.username or "") == values["POSTGRES_USER"]
        and unquote(url.password or "") == values["POSTGRES_PASSWORD"]
    )
except (KeyError, ValueError):
    valid = False

if not valid:
    print(
        "DATABASE_URL and PostgreSQL credentials must target the expected "
        "in-cluster Service and database.",
        file=sys.stderr,
    )
    sys.exit(1)
PY
then
  exit 1
fi

kubectl create secret generic "$APP_SECRET_NAME" \
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

python3 - "$SECRET_FILE" <<'PY' | kubectl apply --namespace="$NAMESPACE" -f -
import json
import sys
from pathlib import Path

values = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    if line and not line.lstrip().startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        values[key] = value
print(json.dumps({"apiVersion": "v1", "kind": "Secret",
                  "metadata": {"name": "clichy-postgres-app"},
                  "type": "kubernetes.io/basic-auth",
                  "stringData": {"username": values["POSTGRES_USER"],
                                 "password": values["POSTGRES_PASSWORD"]}}))
PY
kubectl apply -k "$ROOT_DIR/infra/kubernetes/overlays/$ENVIRONMENT/database"
kubectl wait --namespace="$NAMESPACE" --for=condition=Ready \
  cluster.postgresql.cnpg.io/clichy-postgres --timeout=900s
kubectl get clusters.postgresql.cnpg.io,pods,services,pvc \
  --namespace="$NAMESPACE" --output=wide
echo "Namespace $NAMESPACE prêt. Fichier local : $SECRET_FILE"
