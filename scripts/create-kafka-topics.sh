#!/usr/bin/env bash
# Create the message.sent Kafka topic (idempotent) via kafka-topics.sh inside the broker pod.
#
# Usage:
#   ./scripts/create-kafka-topics.sh
#   ./scripts/create-kafka-topics.sh --partitions 2
#
# Requires kubectl access to the cluster where kafka-deployment runs.
set -euo pipefail

NAMESPACE="${NAMESPACE:-default}"
BOOTSTRAP="${BOOTSTRAP:-localhost:9092}"
TOPIC="${TOPIC:-message.sent}"
PARTITIONS="${PARTITIONS:-2}"
REPLICATION_FACTOR="${REPLICATION_FACTOR:-1}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/create-kafka-topics.sh [options]

Runs kafka-topics.sh inside a Kafka broker pod (kubectl exec).

Options:
  --partitions <N>           Partition count (default 2)
  --replication-factor <N>  Replication factor (default 1; must be ≤ broker count)
  --topic <name>             Topic name (default message.sent)
  --bootstrap <host:port>    Bootstrap from inside the pod (default localhost:9092)
  --namespace <ns>           Kubernetes namespace (default default)
  -h, --help                 Show this help

Env (same names as flags): NAMESPACE, BOOTSTRAP, TOPIC, PARTITIONS, REPLICATION_FACTOR
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --partitions)
      PARTITIONS="${2:?}"
      shift 2
      ;;
    --replication-factor)
      REPLICATION_FACTOR="${2:?}"
      shift 2
      ;;
    --topic)
      TOPIC="${2:?}"
      shift 2
      ;;
    --bootstrap)
      BOOTSTRAP="${2:?}"
      shift 2
      ;;
    --namespace)
      NAMESPACE="${2:?}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! [[ "$PARTITIONS" =~ ^[1-9][0-9]*$ ]]; then
  echo "--partitions must be a positive integer, got: $PARTITIONS" >&2
  exit 1
fi

if ! [[ "$REPLICATION_FACTOR" =~ ^[1-9][0-9]*$ ]]; then
  echo "--replication-factor must be a positive integer, got: $REPLICATION_FACTOR" >&2
  exit 1
fi

pod="$(
  kubectl get pods -n "$NAMESPACE" \
    -l app.kubernetes.io/name=kafka \
    --field-selector=status.phase=Running \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true
)"

if [[ -z "$pod" ]]; then
  echo "error: no Running Kafka pod found in namespace '$NAMESPACE' (label app.kubernetes.io/name=kafka)" >&2
  exit 1
fi

echo "Using pod $NAMESPACE/$pod"
echo "Creating topic '$TOPIC' (partitions=$PARTITIONS replication-factor=$REPLICATION_FACTOR) if missing..."

kubectl exec -n "$NAMESPACE" "$pod" -- \
  kafka-topics.sh \
    --bootstrap-server "$BOOTSTRAP" \
    --create \
    --if-not-exists \
    --topic "$TOPIC" \
    --partitions "$PARTITIONS" \
    --replication-factor "$REPLICATION_FACTOR"

echo "Topics:"
kubectl exec -n "$NAMESPACE" "$pod" -- \
  kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --list
