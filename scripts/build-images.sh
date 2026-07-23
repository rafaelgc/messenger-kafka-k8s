#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="${ROOT}/scripts"

# shellcheck source=push-ecr.sh
source "${SCRIPTS_DIR}/push-ecr.sh"

TAG="latest"
LOAD_KIND=false
PUSH_ECR=false
NO_CACHE=""
BUILD_ALL=false
SERVICES=()
ECR_LOGIN_DONE=false

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
  --push-ecr           Tag and push images to Amazon ECR after build (for EKS)
  --no-cache           Disable Docker build cache
  -h, --help           Show this help

Environment (for --push-ecr):
  AWS_REGION / AWS_DEFAULT_REGION   AWS region (default: aws configure get region)
  AWS_ACCOUNT_ID                    Optional; default: sts get-caller-identity
  ECR_REGISTRY                      Optional; default: <account>.dkr.ecr.<region>.amazonaws.com

Examples:
  $(basename "$0") users --load-kind
  $(basename "$0") -t dev public-api --push-ecr
  $(basename "$0") --all --push-ecr

Notes:
  - Local kind clusters use --load-kind; EKS pulls from ECR (use --push-ecr).
  - ECR repository names match service names (e.g. users, frontend).
  - Prod manifests: run ./scripts/prepare-prod-deploy.sh (or configure-prod-ecr.sh) before kubectl apply -k k8s/overlays/prod
  - Frontend URLs: frontend/.env.prod (default build) or frontend/.env with build-frontend.sh --dev
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
    --push-ecr)
      PUSH_ECR=true
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

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is required but not installed." >&2
    exit 1
  fi
}

load_into_kind() {
  local image="$1"
  if ! command -v kind >/dev/null 2>&1; then
    echo "error: kind is not installed" >&2
    exit 1
  fi
  kind load docker-image "${image}" --name kind
  echo "Loaded ${image} into kind cluster"
}

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
    load_into_kind "${image}"
  fi
  if [[ "${PUSH_ECR}" == "true" ]]; then
    push_ecr_push "${svc}" "${image}" "${TAG}"
  fi
}

export DOCKER_BUILDKIT=1

if [[ "${PUSH_ECR}" == "true" ]]; then
  push_ecr_init
fi

for svc in "${SERVICES[@]}"; do
  case "${svc}" in
    frontend)
      FRONTEND_IMAGE="frontend:${TAG}"
      args=("-t" "${FRONTEND_IMAGE}")
      if [[ "${LOAD_KIND}" == "true" ]]; then
        args+=("--load-kind")
      fi
      if [[ "${PUSH_ECR}" == "true" ]]; then
        args+=("--push-ecr")
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
