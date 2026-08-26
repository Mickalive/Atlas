#!/usr/bin/env bash
set -uo pipefail

REAL="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
MAX_ATTEMPTS="${OPENCODE_MAX_ATTEMPTS:-3}"
RETRY_DELAY="${OPENCODE_RETRY_DELAY_SECONDS:-120}"
LOG="$(mktemp)"
START_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
trap 'rm -f "$LOG"' EXIT

NETWORK_RE='(network_error|NetworkError|network error|fetch failed|APIConnectionError|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ENOTFOUND|ETIMEDOUT|timed out|socket hang up|HTTP[^0-9]*(429|500|502|503|504)|rate.?limit|service unavailable|bad gateway|gateway timeout|temporar(y|ily) unavailable|runner has received a shutdown signal|lost communication with the runner)'

CONTROL_PATHS=(ATLAS_MASTER_PROMPT.md AGENTS.md PRODUCT_CONTRACT.md docs/FORGE_PARITY_MODE.md docs/agents/AGENT_CARDS.md .opencode/agents .github/workflows .github/scripts)

restore_control_plane() {
  [[ -n "$START_HEAD" ]] || return 0
  local p
  for p in "${CONTROL_PATHS[@]}"; do
    git reset -q "$START_HEAD" -- "$p" 2>/dev/null || true
    if git cat-file -e "$START_HEAD:$p" 2>/dev/null; then
      git checkout -q "$START_HEAD" -- "$p" 2>/dev/null || true
    else
      rm -rf -- "$p"
    fi
    git clean -fdq -- "$p" 2>/dev/null || true
  done
}

validate_agent_registry() {
  local registry="docs/agents/AGENT_CARDS.md" bad=0 file id count requested="" prev="" arg
  test -f "$registry" || { echo '::error::Missing canonical Atlas agent registry'; return 64; }

  while IFS= read -r file; do
    id="${file#.opencode/agents/}"; id="${id%.md}"
    count=$(grep -Fc "<!-- AGENT_CARD: ${id} " "$registry" || true)
    if [[ "$count" -ne 1 ]]; then echo "::error::Agent $id has $count canonical cards; expected 1"; bad=1; fi
  done < <(find .opencode/agents -type f -name '*.md' | sort)

  while IFS= read -r id; do
    [[ -f ".opencode/agents/${id}.md" ]] || { echo "::error::Orphan agent card $id"; bad=1; }
  done < <(grep '^<!-- AGENT_CARD:' "$registry" | awk '{print $3}')
  [[ "$bad" -eq 0 ]] || return 66

  for arg in "$@"; do
    if [[ "$prev" == '--agent' ]]; then requested="$arg"; break; fi
    case "$arg" in --agent=*) requested="${arg#--agent=}"; break;; esac
    prev="$arg"
  done
  [[ -z "$requested" ]] && return 0
  count=$(grep -Fc "<!-- AGENT_CARD: ${requested} " "$registry" || true)
  [[ "$count" -eq 1 ]] || { echo "::error::Requested agent $requested lacks one exact canonical card"; return 64; }
  echo "ATLAS_AGENT_CARD_OK agent=$requested"
}

validate_agent_registry "$@" || exit $?

attempt=1
while (( attempt <= MAX_ATTEMPTS )); do
  : > "$LOG"
  echo "ATLAS_OPENCODE_ATTEMPT=$attempt/$MAX_ATTEMPTS"
  set +e
  "$REAL" "$@" > >(tee -a "$LOG") 2> >(tee -a "$LOG" >&2)
  rc=$?
  set -e

  restore_control_plane

  if [[ "$rc" -eq 0 ]]; then exit 0; fi
  if grep -Eiq "$NETWORK_RE" "$LOG"; then
    if (( attempt < MAX_ATTEMPTS )); then
      echo "::warning::Transient OpenCode/network/runner failure; retrying."
      sleep "$RETRY_DELAY"
      attempt=$((attempt + 1))
      continue
    fi
    echo 'ATLAS_TRANSIENT_OX_EXHAUSTED' >&2
    exit 75
  fi
  echo "::error::OpenCode failed rc=$rc"
  exit "$rc"
done
exit 75
