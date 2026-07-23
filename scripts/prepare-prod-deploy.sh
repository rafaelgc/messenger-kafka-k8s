#!/usr/bin/env bash
# One-shot prep before kubectl apply -k k8s/overlays/prod:
#   1. Point prod manifests at this account's ECR
#   2. Install cluster add-ons (MongoDB operator; no ingress-nginx on EKS)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="${ROOT}/scripts"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Prepare an EKS cluster / prod overlay for application deploy:
  1. ./scripts/configure-prod-ecr.sh
  2. ./scripts/install-cluster-addons.sh --skip-ingress-nginx

Run after images are in ECR (./scripts/build-images.sh --all --push-ecr) and
before: kubectl apply -k k8s/overlays/prod

Options:
  -h, --help    Show this help

Environment (passed through to configure-prod-ecr.sh):
  ECR_REGISTRY   Optional; default derived from AWS CLI
  IMAGE_TAG      Image tag for all services (default: latest)
  AWS_REGION     Used when deriving ECR_REGISTRY
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
