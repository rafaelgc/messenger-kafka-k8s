#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="${ROOT}/scripts"
SERVICE_DIR="${ROOT}/frontend"
IMAGE="${IMAGE:-frontend:latest}"
LOAD_KIND=false
PUSH_ECR=false
NO_CACHE=""
USE_DEV=false

# shellcheck source=push-ecr.sh
source "${SCRIPTS_DIR}/push-ecr.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Build the frontend production image.

Options:
  -t, --tag TAG     Image tag (default: frontend:latest)
  --dev             Load URLs from frontend/.env (local development)
  --load-kind       Load image into kind cluster "kind" after build
  --push-ecr        Tag and push image to Amazon ECR after build (for EKS)
  --no-cache        Disable Docker build cache
  -h, --help        Show this help

Environment files:
  frontend/.env.prod   Default — production URLs (NEXT_PUBLIC_*)
  frontend/.env        With --dev — local URLs (Docker Compose)

Environment (for --push-ecr):
  AWS_REGION / AWS_DEFAULT_REGION   AWS region (default: aws configure get region)
  AWS_ACCOUNT_ID                    Optional; default: sts get-caller-identity
  ECR_REGISTRY                      Optional; default: <account>.dkr.ecr.<region>.amazonaws.com

Shell exports of NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL override the file.

Examples:
  $(basename "$0")
  $(basename "$0") --push-ecr
  $(basename "$0") --dev --load-kind
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--tag)
      IMAGE="$2"
      shift 2
      ;;
    --dev)
      USE_DEV=true
      shift
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

ENV_FILE="${SERVICE_DIR}/.env.prod"
if [[ "${USE_DEV}" == "true" ]]; then
  ENV_FILE="${SERVICE_DIR}/.env"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "error: missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${NEXT_PUBLIC_API_URL:-}" || -z "${NEXT_PUBLIC_WS_URL:-}" ]]; then
  echo "error: ${ENV_FILE} must set NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL" >&2
  exit 1
fi

if [[ "${PUSH_ECR}" == "true" ]]; then
  push_ecr_init
fi

export DOCKER_BUILDKIT=1

echo "Building ${IMAGE} from ${SERVICE_DIR}"
echo "Env file: ${ENV_FILE}"
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
    echo "error: kind is not installed" >&2
    exit 1
  fi
  kind load docker-image "${IMAGE}" --name kind
  echo "Loaded ${IMAGE} into kind cluster"
fi

if [[ "${PUSH_ECR}" == "true" ]]; then
  if [[ "${IMAGE}" == *:* ]]; then
    ECR_TAG="${IMAGE##*:}"
  else
    ECR_TAG="latest"
  fi
  push_ecr_push "frontend" "${IMAGE}" "${ECR_TAG}"
fi
