#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 server|web [duration-seconds] [concurrency]" >&2
  exit 2
}

[[ $# -ge 1 && $# -le 3 ]] || usage

TARGET="$1"
DURATION_SECONDS="${2:-300}"
CONCURRENCY="${3:-32}"
NAMESPACE="clichy-test"

case "$TARGET" in
  server)
    DEPLOYMENT="clichy-server"
    REQUEST_PATH="/photos"
    HPA="clichy-server"
    ;;
  web)
    DEPLOYMENT="clichy-web"
    REQUEST_PATH="/"
    HPA="clichy-web"
    ;;
  *) usage ;;
esac

for value in "$DURATION_SECONDS" "$CONCURRENCY"; do
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "Duration and concurrency must be positive integers." >&2
    exit 2
  fi
done
if (( DURATION_SECONDS < 30 || DURATION_SECONDS > 600 )); then
  echo "Duration must be between 30 and 600 seconds." >&2
  exit 2
fi
if (( CONCURRENCY < 1 || CONCURRENCY > 100 )); then
  echo "Concurrency must be between 1 and 100." >&2
  exit 2
fi

for command_name in kubectl node mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command '$command_name' was not found in PATH." >&2
    exit 1
  fi
done

context="$(kubectl config current-context)"
node_names="$(kubectl get nodes --output=jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')"
if [[ "$node_names" != "valtask" ]]; then
  printf "Refusing load generation: expected the single node valtask, got:\n%s\n" \
    "$node_names" >&2
  exit 1
fi

kubectl get deployment "$DEPLOYMENT" --namespace="$NAMESPACE" >/dev/null
kubectl get hpa "$HPA" --namespace="$NAMESPACE" -o wide
kubectl top nodes
kubectl top pods --namespace="$NAMESPACE"
echo "Context: $context"
echo "Target: $NAMESPACE/$DEPLOYMENT$REQUEST_PATH, duration ${DURATION_SECONDS}s, concurrency $CONCURRENCY."
echo "The server target sends read-only GET /photos requests without credentials (expected HTTP 401); the web target requests /. No photo uploads are generated."
read -r -p "Start this Test-only CPU load? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Load generation cancelled."
  exit 1
fi

SERVICE="$DEPLOYMENT"
SERVICE_PORT=3000
if [[ "$TARGET" == "web" ]]; then SERVICE_PORT=80; fi
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/clichy-load.XXXXXX")"
PORT_FORWARD_LOG="$TEMP_DIR/port-forward.log"
PORT_FORWARD_PID=""

cleanup() {
  local exit_status=$?
  trap - EXIT INT TERM
  if [[ -n "$PORT_FORWARD_PID" ]]; then
    kill "$PORT_FORWARD_PID" 2>/dev/null || true
    wait "$PORT_FORWARD_PID" 2>/dev/null || true
  fi
  if [[ "$exit_status" -ne 0 && -s "$PORT_FORWARD_LOG" ]]; then
    cat "$PORT_FORWARD_LOG" >&2
  fi
  rm -f -- "$PORT_FORWARD_LOG"
  rmdir -- "$TEMP_DIR"
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

kubectl port-forward --address=127.0.0.1 --namespace="$NAMESPACE" \
  "service/$SERVICE" ":$SERVICE_PORT" >"$PORT_FORWARD_LOG" 2>&1 &
PORT_FORWARD_PID=$!
LOCAL_PORT=""
for ((attempt = 1; attempt <= 30; attempt++)); do
  if ! kill -0 "$PORT_FORWARD_PID" 2>/dev/null; then
    echo "kubectl port-forward exited before becoming ready." >&2
    exit 1
  fi
  while IFS= read -r log_line; do
    if [[ "$log_line" =~ ^Forwarding\ from\ 127\.0\.0\.1:([0-9]+)\ -\>\ $SERVICE_PORT$ ]]; then
      LOCAL_PORT="${BASH_REMATCH[1]}"
      break
    fi
  done <"$PORT_FORWARD_LOG"
  [[ -n "$LOCAL_PORT" ]] && break
  sleep 1
done
if [[ -z "$LOCAL_PORT" ]]; then
  echo "Timed out waiting for the loopback port-forward." >&2
  exit 1
fi

URL="http://127.0.0.1:$LOCAL_PORT$REQUEST_PATH"

node --input-type=module - "$DURATION_SECONDS" "$CONCURRENCY" "$URL" <<'NODE'
const durationSeconds = Number(process.argv[2]);
const concurrency = Number(process.argv[3]);
const url = process.argv[4];
const startedAt = Date.now();
const deadline = startedAt + durationSeconds * 1000;
const counts = { ok: 0, unauthorized: 0, other: 0, errors: 0 };

async function sendRequests() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
      if (response.status === 401) counts.unauthorized += 1;
      else if (response.ok) counts.ok += 1;
      else counts.other += 1;
    } catch {
      counts.errors += 1;
    }
  }
}

const reporter = setInterval(() => {
  console.log(JSON.stringify({ elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000), ...counts }));
}, 10_000);
await Promise.all(Array.from({ length: concurrency }, sendRequests));
clearInterval(reporter);
console.log(JSON.stringify({ elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000), ...counts }));
if (counts.errors > 0 || counts.other > 0) process.exitCode = 1;
NODE
