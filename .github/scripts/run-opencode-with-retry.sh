#!/usr/bin/env bash
set -uo pipefail

REAL="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
MAX_ATTEMPTS="${OPENCODE_MAX_ATTEMPTS:-3}"
RETRY_DELAY="${OPENCODE_RETRY_DELAY_SECONDS:-120}"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

NETWORK_RE='(network_error|NetworkError|fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ENOTFOUND|ETIMEDOUT|timed out|socket hang up|HTTP[^0-9]*(429|500|502|503|504)|rate.?limit|service unavailable|bad gateway|gateway timeout|temporar(y|ily) unavailable)'

attempt=1
while (( attempt <= MAX_ATTEMPTS )); do
  : > "$LOG"
  echo "ATLAS_OPENCODE_ATTEMPT=$attempt/$MAX_ATTEMPTS"
  set +e
  "$REAL" "$@" > >(tee -a "$LOG") 2> >(tee -a "$LOG" >&2)
  rc=$?
  set -e

  if [[ "$rc" -eq 0 ]]; then
    exit 0
  fi

  if grep -Eiq "$NETWORK_RE" "$LOG" && (( attempt < MAX_ATTEMPTS )); then
    echo "::warning::Transient OpenCode/network failure; retrying."
    sleep "$RETRY_DELAY"
    attempt=$((attempt + 1))
    continue
  fi

  echo "::error::OpenCode failed rc=$rc"
  exit "$rc"
done

exit 75
