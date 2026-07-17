#!/usr/bin/env bash
# Fire-and-forget invoke of messenger-load-test-simulate-user (uid 0 .. N-1).
#
# Uses async Lambda invocation (--invocation-type Event) so the local aws CLI
# returns as soon as AWS accepts the call — it does not wait for the handler.
#
# Usage:
#   ./scripts/load-test/invoke-simulate-users.sh --users 100 --start-at 2026-07-16T20:00:00Z
#
# Env:
#   FUNCTION_NAME   default messenger-load-test-simulate-user
#   CONCURRENCY     max parallel aws CLI processes (default 32)
set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-messenger-load-test-simulate-user}"
USERS=""
START_AT=""
REGISTER_WAIT_MS=""
CONCURRENCY="${CONCURRENCY:-32}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/load-test/invoke-simulate-users.sh --users <N> --start-at <UTC ISO-8601> [options]

Async-invokes the load-test Lambda N times (uid=0 .. N-1), each with users=N.
Does not wait for handler results — check CloudWatch for success/errors.

Options:
  --users <N>               Number of virtual users / invocations (required)
  --start-at <ISO-8601>     Shared UTC start time, e.g. 2026-07-16T20:00:00Z (required)
  --register-wait-ms <ms>   Optional; overrides Lambda REGISTER_WAIT_MS for this run
  --concurrency <N>         Max parallel aws CLI invokes (default 32)
  -h, --help                Show this help

Env:
  FUNCTION_NAME   default messenger-load-test-simulate-user
  CONCURRENCY     default 32
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --users)
      USERS="${2:?}"
      shift 2
      ;;
    --start-at)
      START_AT="${2:?}"
      shift 2
      ;;
    --register-wait-ms)
      REGISTER_WAIT_MS="${2:?}"
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

if [[ -z "$USERS" || -z "$START_AT" ]]; then
  usage >&2
  exit 1
fi

if ! [[ "$USERS" =~ ^[1-9][0-9]*$ ]]; then
  echo "--users must be a positive integer, got: $USERS" >&2
  exit 1
fi

if (( USERS < 4 )); then
  echo "--users must be >= 4 (each user needs 3 peer chats), got: $USERS" >&2
  exit 1
fi

if ! [[ "$CONCURRENCY" =~ ^[1-9][0-9]*$ ]]; then
  echo "--concurrency must be a positive integer, got: $CONCURRENCY" >&2
  exit 1
fi

OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/load-test-invoke.XXXXXX")"

echo "Async-invoking $FUNCTION_NAME $USERS time(s) (concurrency=$CONCURRENCY)"
echo "startAt=$START_AT users=$USERS"
echo "Handler results are not collected — use CloudWatch Logs/Metrics."

failed=0

for ((uid = 0; uid < USERS; uid++)); do
  # Limit parallel local aws CLI processes (macOS-friendly; no wait -n).
  while [[ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$CONCURRENCY" ]]; do
    sleep 0.05
  done

  payload=$(jq -nc \
    --argjson uid "$uid" \
    --argjson users "$USERS" \
    --arg startAt "$START_AT" \
    --arg registerWaitMs "$REGISTER_WAIT_MS" \
    '
      {uid: $uid, users: $users, startAt: $startAt}
      + (if $registerWaitMs == "" then {} else {registerWaitMs: ($registerWaitMs | tonumber)} end)
    ')

  out_file="$OUT_DIR/uid-${uid}.json"
  (
    # Event = fire-and-forget: CLI returns when AWS accepts the invoke.
    if aws lambda invoke \
      --function-name "$FUNCTION_NAME" \
      --invocation-type Event \
      --cli-binary-format raw-in-base64-out \
      --payload "$payload" \
      "$out_file" >/dev/null; then
      echo "uid=$uid accepted"
      exit 0
    else
      echo "uid=$uid FAILED" >&2
      exit 1
    fi
  ) &
done

set +e
wait
set -e

echo "Done launching (cli metadata in $OUT_DIR)."
echo "'accepted' means AWS queued the invoke — not that the simulation finished."
exit 0
