#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="${ROOT}/scripts"

TAG="latest"
LOAD_KIND=false
NO_CACHE=""
INCLUDE_FRONTEND=false
BUILD_ALL=false
SERVICES=()

usage() {
  cat <<EOF
Usage: $(basename "$0") <service>|--all [options]

Build production Docker images for services.

Services:
  users
  chat
  public-api
  message-delivery
  message-storage
  frontend (special: uses NEXT_PUBLIC_* env vars)

Options:
  -t, --tag TAG        Image tag suffix (default: latest)
  --load-kind          Load built images into the kind cluster named "kind"
                       (after docker build)
  --no-cache           Disable Docker build cache
  -h, --help           Show this help

Examples:
  $(basename "$0") users --load-kind
  $(basename "$0") -t dev public-api
  $(basename "$0") --all --load-kind

Notes:
  - For services, final image names are: <service>:<TAG>
  - For frontend, it delegates to ./scripts/build-frontend.sh and passes -t
    as "frontend:<TAG>".
  - NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL are read by build-frontend.sh.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--tag)
      TAG="$2"
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
    --all)
      BUILD_ALL=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      SERVICES+=("$1")
      shift
      ;;
  esac
done

if [[ "${BUILD_ALL}" == "true" ]]; then
  SERVICES=(users chat public-api message-delivery message-storage frontend)
fi

if [[ "${#SERVICES[@]}" -eq 0 ]]; then
  echo "error: specify a service name or --all" >&2
  usage >&2
  exit 1
fi

export DOCKER_BUILDKIT=1

build_rust_service() {
  local svc="$1"
  local service_dir="$2"
  local image="${svc}:${TAG}"

  echo "Building ${image} from ${service_dir}"
  docker build \
    ${NO_CACHE} \
    -f "${service_dir}/Dockerfile" \
    -t "${image}" \
    "${service_dir}"

  echo "Built ${image}"

  if [[ "${LOAD_KIND}" == "true" ]]; then
    if ! command -v kind >/dev/null 2>&1; then
      echo "kind is not installed; skipping cluster load" >&2
      exit 1
    fi
    kind load docker-image "${image}" --name kind
    echo "Loaded ${image} into kind cluster"
  fi
}

for svc in "${SERVICES[@]}"; do
  case "${svc}" in
    frontend)
      # Frontend build is special: its Dockerfile bakes NEXT_PUBLIC_* values.
      FRONTEND_IMAGE="frontend:${TAG}"
      args=()
      args+=("-t" "${FRONTEND_IMAGE}")
      if [[ "${LOAD_KIND}" == "true" ]]; then
        args+=("--load-kind")
      fi
      if [[ -n "${NO_CACHE}" ]]; then
        args+=("--no-cache")
      fi
      "${SCRIPTS_DIR}/build-frontend.sh" "${args[@]}"
      ;;
    users)
      build_rust_service "users" "${ROOT}/services/users"
      ;;
    chat)
      build_rust_service "chat" "${ROOT}/services/chat"
      ;;
    public-api)
      build_rust_service "public-api" "${ROOT}/services/public-api"
      ;;
    message-delivery)
      build_rust_service "message-delivery" "${ROOT}/services/message-delivery"
      ;;
    message-storage)
      build_rust_service "message-storage" "${ROOT}/services/message-storage"
      ;;
    *)
      echo "error: unknown service '${svc}'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

