#!/usr/bin/env bash
# One-shot prep before kubectl apply -k k8s/overlays/prod:
#   1. aws eks update-kubeconfig (default region)
#   2. Point prod manifests at this account's ECR
#   3. Install cluster add-ons (MongoDB operator; no ingress-nginx on EKS)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="${ROOT}/scripts"
CLUSTER_NAME=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Prepare an EKS cluster / prod overlay for application deploy:
  1. aws eks update-kubeconfig (uses the default AWS CLI region)
  2. ./scripts/configure-prod-ecr.sh
  3. ./scripts/install-cluster-addons.sh --skip-ingress-nginx

Run after images are in ECR (./scripts/build-images.sh --all --push-ecr) and
before: kubectl apply -k k8s/overlays/prod

Options:
  --cluster-name <name>   EKS cluster name (required if the account has more than one)
  -h, --help              Show this help

Environment (passed through to configure-prod-ecr.sh):
  ECR_REGISTRY   Optional; default derived from AWS CLI
  IMAGE_TAG      Image tag for all services (default: latest)
  AWS_REGION     Used when deriving ECR_REGISTRY
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-name)
      CLUSTER_NAME="${2:?--cluster-name requires a value}"
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

update_kubeconfig() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "error: AWS CLI is required for update-kubeconfig" >&2
    exit 1
  fi

  local name="$CLUSTER_NAME"
  if [[ -z "$name" ]]; then
    local clusters
    clusters="$(aws eks list-clusters --query 'clusters[]' --output text)"
    # list-clusters with --output text joins names with tabs; normalize to lines.
    local -a names=()
    local c
    for c in $clusters; do
      [[ -n "$c" ]] && names+=("$c")
    done

    if ((${#names[@]} == 0)); then
      echo "error: no EKS clusters found in the default region." >&2
      echo "Deploy the CDK stack first, then re-run this script." >&2
      exit 1
    fi

    if ((${#names[@]} > 1)); then
      echo "error: multiple EKS clusters found:" >&2
      for c in "${names[@]}"; do
        echo "  - $c" >&2
      done
      echo "Re-run with --cluster-name <name>." >&2
      exit 1
    fi

    name="${names[0]}"
  fi

  echo "==> Updating kubeconfig for cluster: $name"
  aws eks update-kubeconfig --name "$name"
}

update_kubeconfig

echo
echo "==> Configuring prod overlay for ECR"
"${SCRIPTS_DIR}/configure-prod-ecr.sh"

echo
echo "==> Installing cluster add-ons (EKS: skip ingress-nginx)"
"${SCRIPTS_DIR}/install-cluster-addons.sh" --skip-ingress-nginx

echo
echo "==> Prod prep complete"
echo "Edit hostnames if needed: k8s/overlays/prod/hosts-configmap.yaml"
echo "Then: kubectl apply -k k8s/overlays/prod"
echo "After Kafka is Running: ./scripts/create-kafka-topics.sh"
