#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd -- "$ROOT_DIR"

usage() {
  echo "Usage: $0 test|prod [deploy|status]" >&2
  exit 2
}

die() {
  echo "Error: $*" >&2
  exit 1
}

port_forward_running() {
  local job_pid
  while IFS= read -r job_pid; do
    if [[ "$job_pid" == "$port_forward_pid" ]]; then
      return 0
    fi
  done < <(jobs -pr)
  return 1
}

[[ $# -ge 1 && $# -le 2 ]] || usage

ENVIRONMENT="$1"
ACTION="${2:-deploy}"

case "$ENVIRONMENT" in
  test)
    NAMESPACE="clichy-test"
    SERVICE="clichy-postgres"
    SECRET="clichy-server-secrets"
    EXPECTED_DATABASE="clichy_test"
    ;;
  prod)
    NAMESPACE="clichy-prod"
    SERVICE="clichy-postgres"
    SECRET="clichy-prod-secrets"
    EXPECTED_DATABASE="clichy_prod"
    ;;
  *)
    usage
    ;;
esac

case "$ACTION" in
  deploy|status) ;;
  *) usage ;;
esac

unset DATABASE_URL

for command_name in git kubectl node pnpm mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    die "Required command '$command_name' was not found in PATH."
  fi
done

if [[ "$ACTION" == "deploy" ]]; then
  checked_out_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)" ||
    die "Could not determine the checked-out Git commit."
  if [[ -n "${GITHUB_SHA:-}" && "$checked_out_sha" != "$GITHUB_SHA" ]]; then
    die "Checked-out migration source does not match the workflow commit."
  fi
  changed_sources="$(git -C "$ROOT_DIR" status --porcelain --untracked-files=all -- \
    infra/kubernetes/scripts/deploy.sh \
    infra/kubernetes/scripts/migrate.sh \
    infra/kubernetes/base \
    "infra/kubernetes/overlays/$ENVIRONMENT" \
    packages/db/package.json \
    packages/db/prisma.config.ts \
    packages/db/prisma/schema \
    packages/db/prisma/migrations \
    pnpm-lock.yaml \
    pnpm-workspace.yaml)" ||
    die "Could not verify that migration and deployment sources are clean."
  if [[ -n "$changed_sources" ]]; then
    die "Migration or deployment sources contain uncommitted changes; use a clean checkout."
  fi
fi

context="$(kubectl config current-context)" ||
  die "Could not read the current Kubernetes context."
node_names="$(kubectl get nodes \
  --output=jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')" ||
  die "Could not read Kubernetes nodes from context '$context'."
if [[ "$node_names" != "valtask" ]]; then
  printf "Refusing to migrate %s: expected the single node valtask, got:\n%s\n" \
    "$ENVIRONMENT" "$node_names" >&2
  exit 1
fi

service_resource="$(kubectl get service "$SERVICE" \
  --namespace="$NAMESPACE" \
  --ignore-not-found \
  --output=name)" ||
  die "Could not inspect PostgreSQL Service '$SERVICE' in namespace '$NAMESPACE'."
if [[ -z "$service_resource" ]]; then
  die "PostgreSQL Service '$SERVICE' is missing from namespace '$NAMESPACE'."
fi

database_url_encoded="$(kubectl get secret "$SECRET" \
  --namespace="$NAMESPACE" \
  --output='jsonpath={.data.DATABASE_URL}')" ||
  die "Could not read key DATABASE_URL from Secret '$SECRET' in namespace '$NAMESPACE'."
if [[ -z "$database_url_encoded" ]]; then
  die "Key DATABASE_URL is missing or empty in Secret '$SECRET' in namespace '$NAMESPACE'."
fi

echo "Migration target: $ENVIRONMENT, namespace $NAMESPACE, Service $SERVICE, Secret $SECRET, database $EXPECTED_DATABASE."

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/clichy-migrate.XXXXXX")" ||
  die "Could not create a temporary port-forward directory."
port_forward_log="$temp_dir/port-forward.log"
: >"$port_forward_log"
port_forward_pid=""

cleanup() {
  local exit_status=$?
  trap - EXIT INT TERM

  if [[ -n "$port_forward_pid" ]]; then
    if port_forward_running; then
      kill "$port_forward_pid" 2>/dev/null || true
    fi
    wait "$port_forward_pid" 2>/dev/null || true
  fi

  unset DATABASE_URL database_url_encoded
  rm -f -- "$port_forward_log" || true
  rmdir -- "$temp_dir" || true
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

kubectl port-forward --address=127.0.0.1 \
  --namespace="$NAMESPACE" \
  "service/$SERVICE" :5432 \
  >"$port_forward_log" 2>&1 &
port_forward_pid=$!

local_port=""
port_forward_ready=false
for ((attempt = 1; attempt <= 30; attempt++)); do
  if ! port_forward_running; then
    if wait "$port_forward_pid"; then
      port_forward_status=0
    else
      port_forward_status=$?
    fi
    cat "$port_forward_log" >&2
    die "kubectl port-forward exited with status $port_forward_status for $NAMESPACE/$SERVICE."
  fi

  while IFS= read -r log_line; do
    if [[ "$log_line" =~ ^Forwarding\ from\ 127\.0\.0\.1:([0-9]+)\ -\>\ 5432$ ]]; then
      local_port="${BASH_REMATCH[1]}"
      break
    fi
  done <"$port_forward_log"

  if [[ -n "$local_port" ]] &&
    (echo >"/dev/tcp/127.0.0.1/$local_port") >/dev/null 2>&1 &&
    port_forward_running; then
    port_forward_ready=true
    break
  fi
  sleep 1
done

if [[ "$port_forward_ready" != true ]]; then
  cat "$port_forward_log" >&2
  die "Timed out waiting for the loopback PostgreSQL port-forward in namespace '$NAMESPACE'."
fi

DATABASE_URL="$(
  printf '%s' "$database_url_encoded" |
    EXPECTED_DATABASE="$EXPECTED_DATABASE" LOCAL_DB_PORT="$local_port" node -e '
      let encoded = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => encoded += chunk);
      process.stdin.on("end", () => {
        try {
          const value = Buffer.from(encoded.trim(), "base64").toString("utf8");
          const url = new URL(value);
          if (!["postgres:", "postgresql:"].includes(url.protocol)) {
            throw new Error();
          }
          const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
          if (database !== process.env.EXPECTED_DATABASE) {
            process.stderr.write(
              "DATABASE_URL does not target the expected environment database.\n",
            );
            process.exitCode = 1;
            return;
          }
          url.hostname = "127.0.0.1";
          url.port = process.env.LOCAL_DB_PORT;
          process.stdout.write(url.toString());
        } catch {
          process.stderr.write(
            "DATABASE_URL in the selected Kubernetes Secret is invalid.\n",
          );
          process.exitCode = 1;
        }
      });
    '
)" || die "Could not prepare a loopback-only DATABASE_URL from Secret '$SECRET'."
unset database_url_encoded
export DATABASE_URL

case "$ACTION" in
  deploy)
    echo "Applying pending Prisma migrations for $ENVIRONMENT."
    if ! pnpm --filter @clichy/db db:migrate:deploy; then
      die "Prisma migrate deploy failed for $ENVIRONMENT; the application deployment was not applied."
    fi
    ;;
  status)
    echo "Inspecting Prisma migration status for $ENVIRONMENT (no migrations will be applied)."
    if pnpm --filter @clichy/db exec prisma migrate status; then
      :
    else
      status_code=$?
      echo "Prisma migrate status exited with status $status_code; pending migrations may cause a non-zero status." >&2
      exit "$status_code"
    fi
    ;;
esac
