#!/usr/bin/env bash
# Fire-and-forget invoke of messenger-load-test-simulate-user in batches.
#
# Each Lambda simulates --batch-size users concurrently (uidStart .. uidStart+batchSize-1).
# Uses async invocation (--invocation-type Event).
#
# Usage:
#   ./scripts/load-test/invoke-simulate-users.sh \
#     --users 1000 --batch-size 25 --start-in 60
#   ./scripts/load-test/invoke-simulate-users.sh \
#     --users 1000 --batch-size 25 --start-at 2026-07-18T20:00:00Z
#
# Env:
#   FUNCTION_NAME   default messenger-load-test-simulate-user
#   CONCURRENCY     max parallel aws CLI processes (default 32)
#   BATCH_SIZE      default 25 if --batch-size omitted
set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-messenger-load-test-simulate-user}"
USERS=""
START_AT=""
START_IN=""
REGISTER_WAIT_MS=""
CONCURRENCY="${CONCURRENCY:-32}"
BATCH_SIZE="${BATCH_SIZE:-25}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/load-test/invoke-simulate-users.sh --users <N> (--start-in <sec> | --start-at <UTC ISO-8601>) [options]

Async-invokes the load-test Lambda ceil(N/batch-size) times. Each invoke runs
batch-size virtual users concurrently (uid ranges cover 0 .. N-1).

Options:
  --users <N>               Total virtual users / population size (required)
  --batch-size <N>          Users simulated per Lambda (default 25)
  --start-in <seconds>      Shared start = now (UTC) + seconds (required unless --start-at)
  --start-at <ISO-8601>     Shared UTC start time (required unless --start-in)
  --register-wait-ms <ms>   Optional; overrides Lambda REGISTER_WAIT_MS for this run
  --concurrency <N>         Max parallel aws CLI invokes (default 32)
  -h, --help                Show this help

Env:
  FUNCTION_NAME   default messenger-load-test-simulate-user
  CONCURRENCY     default 32
  BATCH_SIZE      default 25

Example (1000 users, 40 Lambdas × 25 users each, start in 60s):
  ./scripts/load-test/invoke-simulate-users.sh \
    --users 1000 --batch-size 25 --start-in 60
EOF
}

# UTC ISO-8601 from epoch seconds (GNU date and macOS BSD date).
utc_iso_from_epoch() {
  local epoch="$1"
  if date -u -d "@0" +%Y-%m-%dT%H:%M:%SZ >/dev/null 2>&1; then
    date -u -d "@${epoch}" +%Y-%m-%dT%H:%M:%SZ
  else
    date -u -r "${epoch}" +%Y-%m-%dT%H:%M:%SZ
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --users)
      USERS="${2:?}"
      shift 2
      ;;
    --batch-size)
      BATCH_SIZE="${2:?}"
      shift 2
      ;;
    --start-at)
      START_AT="${2:?}"
      shift 2
      ;;
    --start-in)
      START_IN="${2:?}"
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

if [[ -z "$USERS" ]]; then
  usage >&2
  exit 1
fi

if [[ -n "$START_AT" && -n "$START_IN" ]]; then
  echo "Use only one of --start-at or --start-in" >&2
  exit 1
fi

if [[ -z "$START_AT" && -z "$START_IN" ]]; then
  echo "Either --start-at or --start-in is required" >&2
  usage >&2
  exit 1
fi

if [[ -n "$START_IN" ]]; then
  if ! [[ "$START_IN" =~ ^[0-9]+$ ]]; then
    echo "--start-in must be a non-negative integer (seconds), got: $START_IN" >&2
    exit 1
  fi
  START_AT="$(utc_iso_from_epoch "$(($(date +%s) + START_IN))")"
fi

if ! [[ "$USERS" =~ ^[1-9][0-9]*$ ]]; then
  echo "--users must be a positive integer, got: $USERS" >&2
  exit 1
fi

if (( USERS < 4 )); then
  echo "--users must be >= 4 (each user needs 3 peer chats), got: $USERS" >&2
  exit 1
fi

if ! [[ "$BATCH_SIZE" =~ ^[1-9][0-9]*$ ]]; then
  echo "--batch-size must be a positive integer, got: $BATCH_SIZE" >&2
  exit 1
fi

if ! [[ "$CONCURRENCY" =~ ^[1-9][0-9]*$ ]]; then
  echo "--concurrency must be a positive integer, got: $CONCURRENCY" >&2
  exit 1
fi

OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/load-test-invoke.XXXXXX")"
INVOKES=$(( (USERS + BATCH_SIZE - 1) / BATCH_SIZE ))

echo "Async-invoking $FUNCTION_NAME $INVOKES time(s) (users=$USERS batch-size=$BATCH_SIZE concurrency=$CONCURRENCY)"
if [[ -n "$START_IN" ]]; then
  echo "startAt=$START_AT (start-in=${START_IN}s)"
else
  echo "startAt=$START_AT"
fi
echo "Handler results are not collected — use CloudWatch Logs/Metrics."

for ((uid_start = 0; uid_start < USERS; uid_start += BATCH_SIZE)); do
  while [[ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$CONCURRENCY" ]]; do
    sleep 0.05
  done

  remaining=$((USERS - uid_start))
  this_batch=$BATCH_SIZE
  if (( remaining < BATCH_SIZE )); then
    this_batch=$remaining
  fi

  payload=$(jq -nc \
    --argjson uidStart "$uid_start" \
    --argjson batchSize "$this_batch" \
    --argjson users "$USERS" \
    --arg startAt "$START_AT" \
    --arg registerWaitMs "$REGISTER_WAIT_MS" \
    '
      {uidStart: $uidStart, batchSize: $batchSize, users: $users, startAt: $startAt}
      + (if $registerWaitMs == "" then {} else {registerWaitMs: ($registerWaitMs | tonumber)} end)
    ')

  out_file="$OUT_DIR/uidStart-${uid_start}.json"
  (
    if aws lambda invoke \
      --function-name "$FUNCTION_NAME" \
      --invocation-type Event \
      --cli-binary-format raw-in-base64-out \
      --payload "$payload" \
      "$out_file" >/dev/null; then
      echo "uidStart=$uid_start batchSize=$this_batch accepted"
      exit 0
    else
      echo "uidStart=$uid_start batchSize=$this_batch FAILED" >&2
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
