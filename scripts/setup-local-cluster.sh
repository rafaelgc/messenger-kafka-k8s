#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

INGRESS_NGINX_MANIFEST="${INGRESS_NGINX_MANIFEST:-https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/cloud/deploy.yaml}"
MONGODB_HELM_REPO="${MONGODB_HELM_REPO:-mongodb}"
MONGODB_HELM_REPO_URL="${MONGODB_HELM_REPO_URL:-https://mongodb.github.io/helm-charts}"
MONGODB_OPERATOR_RELEASE="${MONGODB_OPERATOR_RELEASE:-community-operator}"
MONGODB_OPERATOR_NAMESPACE="${MONGODB_OPERATOR_NAMESPACE:-mongodb-operator}"
MONGODB_OPERATOR_CHART="${MONGODB_OPERATOR_CHART:-mongodb/community-operator}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Install cluster prerequisites for local Kubernetes development:
  - ingress-nginx controller
  - MongoDB Community Operator (CRDs + operator in ${MONGODB_OPERATOR_NAMESPACE})

Run once on a new cluster or after a cluster reset, before:
  kubectl apply -k k8s/overlays/local

Options:
  -h, --help   Show this help

Requires: kubectl, helm, and a reachable cluster (Docker Desktop / kind).
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

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is required but not installed." >&2
    exit 1
  fi
}

log() {
  echo "==> $*"
}

require_command kubectl
require_command helm

log "Checking cluster connectivity"
if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "error: cannot reach the Kubernetes cluster. Enable Kubernetes in Docker Desktop," >&2
  echo "       start your kind cluster, or fix your kubeconfig." >&2
  exit 1
fi

log "Installing ingress-nginx controller"
if kubectl get deployment -n ingress-nginx ingress-nginx-controller >/dev/null 2>&1; then
  echo "    ingress-nginx already installed; waiting for controller to be ready"
else
  kubectl apply -f "${INGRESS_NGINX_MANIFEST}"
fi
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  -l app.kubernetes.io/component=controller \
  --timeout=180s

log "Installing MongoDB Community Operator"
if ! helm repo list | awk '{print $1}' | grep -qx "${MONGODB_HELM_REPO}"; then
  helm repo add "${MONGODB_HELM_REPO}" "${MONGODB_HELM_REPO_URL}"
fi
helm repo update "${MONGODB_HELM_REPO}" >/dev/null

if helm status "${MONGODB_OPERATOR_RELEASE}" -n "${MONGODB_OPERATOR_NAMESPACE}" >/dev/null 2>&1; then
  echo "    ${MONGODB_OPERATOR_RELEASE} already installed in ${MONGODB_OPERATOR_NAMESPACE}"
else
  helm_install_args=(
    install "${MONGODB_OPERATOR_RELEASE}" "${MONGODB_OPERATOR_CHART}"
    -n "${MONGODB_OPERATOR_NAMESPACE}"
    --create-namespace
  )
  if kubectl get crd mongodbcommunity.mongodbcommunity.mongodb.com >/dev/null 2>&1; then
    echo "    MongoDBCommunity CRD already present; skipping CRD install"
    helm_install_args+=(--set community-operator-crds.enabled=false)
  fi
  helm "${helm_install_args[@]}"
fi

kubectl rollout status deployment/mongodb-kubernetes-operator \
  -n "${MONGODB_OPERATOR_NAMESPACE}" \
  --timeout=180s

log "Cluster prerequisites are ready"
echo
echo "Next: deploy the application with"
echo "  kubectl apply -k k8s/overlays/local"
echo
echo "Then open http://app.localhost (and other *.localhost hosts from k8s/base/ingress.yaml)."
