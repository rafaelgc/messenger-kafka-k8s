#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${ROOT}/services/public-api"
IMAGE="${IMAGE:-public-api:latest}"
LOAD_KIND=false
NO_CACHE=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Build the public-api production image.

Options:
  -t, --tag TAG     Image tag (default: public-api:latest)
  --load-kind       Load image into kind cluster "kind" after build
  --no-cache        Disable Docker build cache
  -h, --help        Show this help

Environment:
  IMAGE             Same as --tag

Examples:
  $(basename "$0")
  $(basename "$0") -t public-api:latest
  $(basename "$0") --load-kind
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
docker build \
  ${NO_CACHE} \
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
