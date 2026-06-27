#!/usr/bin/env bash
set -euo pipefail

SERVICE="${SERVICE:-public-api-service}"
LOCAL_PORT="${LOCAL_PORT:-8080}"
REMOTE_PORT="${REMOTE_PORT:-8080}"
NAMESPACE="${NAMESPACE:-}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Forward public-api from the cluster to localhost.

Options:
  -p, --local-port PORT   Local port (default: 8080)
  -r, --remote-port PORT  Service port in the cluster (default: 8080)
  -n, --namespace NS      Kubernetes namespace (default: current context)
  -h, --help              Show this help

Environment:
  SERVICE, LOCAL_PORT, REMOTE_PORT, NAMESPACE

Examples:
  $(basename "$0")
  $(basename "$0") -p 8080
  LOCAL_PORT=9090 $(basename "$0")

Then open http://localhost:${LOCAL_PORT}/
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--local-port)
      LOCAL_PORT="$2"
      shift 2
      ;;
    -r|--remote-port)
      REMOTE_PORT="$2"
      shift 2
      ;;
    -n|--namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is not installed" >&2
  exit 1
fi

NS_ARGS=()
if [[ -n "${NAMESPACE}" ]]; then
  NS_ARGS=(-n "${NAMESPACE}")
fi

echo "Forwarding http://localhost:${LOCAL_PORT} -> svc/${SERVICE}:${REMOTE_PORT}"
echo "Press Ctrl+C to stop."
exec kubectl port-forward "${NS_ARGS[@]}" "svc/${SERVICE}" "${LOCAL_PORT}:${REMOTE_PORT}"
