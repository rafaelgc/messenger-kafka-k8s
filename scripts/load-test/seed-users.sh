#!/usr/bin/env bash
# Seed load-test users (user0 .. user{N-1}) via POST /users.
#
# Usage:
#   ./scripts/load-test/seed-users.sh --users 1000
#   API_BASE_URL=http://api.localhost ./scripts/load-test/seed-users.sh --users 100
#
# Idempotent: HTTP 409 (nickname taken) counts as success.
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://api.messenger.rgonzalez.xyz}"
PASSWORD="${LOAD_TEST_PASSWORD:-load-test-password}"
CONCURRENCY="${SEED_CONCURRENCY:-32}"
USERS=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/load-test/seed-users.sh --users <N> [--concurrency <N>]

Creates nicknames user0 .. user{N-1}.

Options:
  --users <N>         Number of users to create (required)
  --concurrency <N>   Max parallel curl requests (default 32)
  -h, --help          Show this help

Env:
  API_BASE_URL          default http://api.messenger.rgonzalez.xyz
  LOAD_TEST_PASSWORD    default load-test-password
  SEED_CONCURRENCY      default 32
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --users)
      USERS="${2:?}"
      shift 2
      ;;
    --concurrency)
      CONCURRENCY="${2:?}"
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

if [[ -z "$USERS" ]]; then
  usage >&2
  exit 1
fi

if ! [[ "$USERS" =~ ^[1-9][0-9]*$ ]]; then
  echo "--users must be a positive integer, got: $USERS" >&2
  exit 1
fi

if ! [[ "$CONCURRENCY" =~ ^[1-9][0-9]*$ ]]; then
  echo "--concurrency must be a positive integer, got: $CONCURRENCY" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi

RESULT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/seed-users.XXXXXX")"
echo "Seeding $USERS users at $API_BASE_URL (concurrency=$CONCURRENCY)"

for ((uid = 0; uid < USERS; uid++)); do
  while [[ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$CONCURRENCY" ]]; do
    sleep 0.05
  done

  (
    nickname="user${uid}"
    code="$(
      curl -sS -o /dev/null -w "%{http_code}" \
        -X POST "${API_BASE_URL}/users" \
        -H "Content-Type: application/json" \
        -d "{\"nickname\":\"${nickname}\",\"password\":\"${PASSWORD}\"}"
    )" || code="000"

    case "$code" in
      201)
        echo "${nickname} created"
        echo created >"${RESULT_DIR}/${uid}"
        ;;
      409)
        echo "${nickname} already exists"
        echo existed >"${RESULT_DIR}/${uid}"
        ;;
      *)
        echo "${nickname} FAILED (HTTP ${code})" >&2
        echo failed >"${RESULT_DIR}/${uid}"
        ;;
    esac
  ) &
done

wait

created=0
existed=0
failed=0

for ((uid = 0; uid < USERS; uid++)); do
  if [[ -f "${RESULT_DIR}/${uid}" ]]; then
    case "$(cat "${RESULT_DIR}/${uid}")" in
      created) created=$((created + 1)) ;;
      existed) existed=$((existed + 1)) ;;
      failed) failed=$((failed + 1)) ;;
    esac
  else
    failed=$((failed + 1))
  fi
done

rm -rf "$RESULT_DIR"

echo "Done. created=$created existed=$existed failed=$failed / $USERS"
if (( failed > 0 )); then
  exit 1
fi
exit 0
