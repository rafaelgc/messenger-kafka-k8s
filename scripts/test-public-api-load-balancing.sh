#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-http://localhost:8080}"
REQUESTS="${REQUESTS:-20}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Hit public-api and show which pods respond.
Works with Docker Desktop LoadBalancer at http://localhost:8080

Options:
  -u, --url URL       API base URL (default: http://localhost:8080)
  -n, --requests N    Number of requests (default: 20)
  -h, --help          Show this help

Example:
  $(basename "$0")
  $(basename "$0") -u http://localhost:8080 -n 50
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--url)
      HOST="$2"
      shift 2
      ;;
    -n|--requests)
      REQUESTS="$2"
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

echo "Sending ${REQUESTS} requests to ${HOST}/ (no keep-alive)"
for _ in $(seq 1 "${REQUESTS}"); do
  curl -s --no-keepalive "${HOST}/" || echo "(request failed)"
  echo
done | sort | uniq -c | sort -rn
