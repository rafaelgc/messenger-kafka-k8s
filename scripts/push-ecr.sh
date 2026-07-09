#!/usr/bin/env bash
# Shared ECR push helpers. Source from build scripts.
# Expects caller to set PUSH_ECR=true before calling push_ecr_init.

ECR_LOGIN_DONE="${ECR_LOGIN_DONE:-false}"

push_ecr_require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is required but not installed." >&2
    exit 1
  fi
}

push_ecr_init() {
  push_ecr_require_command aws
  AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
  if [[ -z "${AWS_REGION}" ]]; then
    AWS_REGION="$(aws configure get region 2>/dev/null || true)"
  fi
  if [[ -z "${AWS_REGION}" ]]; then
    echo "error: set AWS_REGION or configure a default region for --push-ecr" >&2
    exit 1
  fi
  AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
  ECR_REGISTRY="${ECR_REGISTRY:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
  echo "ECR registry: ${ECR_REGISTRY}"
}

push_ecr_login() {
  if [[ "${ECR_LOGIN_DONE}" == "false" ]]; then
    aws ecr get-login-password --region "${AWS_REGION}" \
      | docker login --username AWS --password-stdin "${ECR_REGISTRY}"
    ECR_LOGIN_DONE=true
  fi
}

push_ecr_ensure_repository() {
  local repo="$1"
  if ! aws ecr describe-repositories \
    --repository-names "${repo}" \
    --region "${AWS_REGION}" >/dev/null 2>&1; then
    echo "Creating ECR repository ${repo}"
    aws ecr create-repository \
      --repository-name "${repo}" \
      --region "${AWS_REGION}" >/dev/null
  fi
}

# push_ecr_push <repo> <local-image> [tag]
push_ecr_push() {
  local repo="$1"
  local local_image="$2"
  local tag="${3:-latest}"
  local remote_image="${ECR_REGISTRY}/${repo}:${tag}"

  push_ecr_login
  push_ecr_ensure_repository "${repo}"
  docker tag "${local_image}" "${remote_image}"
  docker push "${remote_image}"
  echo "Pushed ${remote_image}"
}
