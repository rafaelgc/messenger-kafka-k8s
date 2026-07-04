#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${ROOT}/frontend"
IMAGE="${IMAGE:-frontend:latest}"
LOAD_KIND=false
NO_CACHE=""
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://api.localhost}"
NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-ws://ws.localhost/ws}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Build the frontend production image.

Options:
  -t, --tag TAG     Image tag (default: frontend:latest)
  --load-kind       Load image into kind cluster "kind" after build
  --no-cache        Disable Docker build cache
  -h, --help        Show this help

Environment:
  IMAGE
  NEXT_PUBLIC_API_URL   Baked into the client bundle (default: http://api.localhost)
  NEXT_PUBLIC_WS_URL    Baked into the client bundle (default: ws://ws.localhost/ws)

Examples:
  $(basename "$0")
  NEXT_PUBLIC_API_URL=http://api.localhost $(basename "$0") --load-kind
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--tag)
      IMAGE="$2"
      shift 2
      ;;
    --load-kind)
      LOAD_KIND=true
      shift
      ;;
    --no-cache)
      NO_CACHE="--no-cache"
      shift
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

export DOCKER_BUILDKIT=1

echo "Building ${IMAGE} from ${SERVICE_DIR}"
echo "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}"
echo "NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}"

docker build \
  ${NO_CACHE} \
  --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}" \
  --build-arg "NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}" \
  -f "${SERVICE_DIR}/Dockerfile" \
  -t "${IMAGE}" \
  "${SERVICE_DIR}"

echo "Built ${IMAGE}"

if [[ "${LOAD_KIND}" == true ]]; then
  if ! command -v kind >/dev/null 2>&1; then
    echo "kind is not installed; skipping cluster load" >&2
    exit 1
  fi
  kind load docker-image "${IMAGE}" --name kind
  echo "Loaded ${IMAGE} into kind cluster"
fi
