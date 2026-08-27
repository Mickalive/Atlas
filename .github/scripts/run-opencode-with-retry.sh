#!/usr/bin/env bash
set -uo pipefail

REAL="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
MAX_ROUNDS="${OPENCODE_MODEL_CHAIN_ROUNDS:-2}"
BASE_RETRY_DELAY="${OPENCODE_RETRY_DELAY_SECONDS:-25}"
MAX_RETRY_DELAY="${OPENCODE_MAX_RETRY_DELAY_SECONDS:-120}"
RETRY_JITTER="${OPENCODE_RETRY_JITTER_SECONDS:-25}"
INACTIVITY_LIMIT="${OPENCODE_INACTIVITY_WATCHDOG_SECONDS:-300}"
WATCH_INTERVAL="${OPENCODE_WATCHDOG_POLL_SECONDS:-15}"
LOG="$(mktemp)"
START_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
trap 'rm -f "$LOG"' EXIT

# Current OpenCode Zen free-model routes, verified against current OpenCode docs.
CODING_MODEL_CHAIN_DEFAULT='opencode/deepseek-v4-flash-free opencode/north-mini-code-free opencode/laguna-s-2.1-free'
REASONING_MODEL_CHAIN_DEFAULT='opencode/laguna-s-2.1-free opencode/deepseek-v4-flash-free opencode/mimo-v2.5-free'

TRANSIENT_RE='(network_error|NetworkError|network error|fetch failed|APIConnectionError|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ENOTFOUND|ETIMEDOUT|timed out|socket hang up|HTTP[^0-9]*(429|500|502|503|504)|rate.?limit|free.?usage.?limit|service unavailable|bad gateway|gateway timeout|temporar(y|ily) unavailable|upstream request failed|endpoint is unavailable|unexpected server error|internal server error|provider[^\n]*(unavailable|overloaded|capacity)|server[^\n]*overloaded|try again later|UnknownError|Forbidden[^\n]*model|model[^\n]*(unavailable|not available|disabled)|err_[A-Za-z0-9]+|runner has received a shutdown signal|runner service is stopped|lost communication with the runner)'

CONTROL_PATHS=(ATLAS_MASTER_PROMPT.md AGENTS.md PRODUCT_CONTRACT.md docs/FORGE_PARITY_MODE.md docs/agents/AGENT_CARDS.md state/human_release_attestations.json .opencode/agents .github/workflows .github/scripts)

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

requested_agent_from_args() {
  local prev='' arg
  for arg in "$@"; do
    if [[ "$prev" == '--agent' ]]; then printf '%s\n' "$arg"; return 0; fi
    case "$arg" in --agent=*) printf '%s\n' "${arg#--agent=}"; return 0;; esac
    prev="$arg"
  done
}

validate_agent_registry() {
  local registry="docs/agents/AGENT_CARDS.md" bad=0 file id count requested
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

  requested=$(requested_agent_from_args "$@")
  [[ -z "$requested" ]] && return 0
  count=$(grep -Fc "<!-- AGENT_CARD: ${requested} " "$registry" || true)
  [[ "$count" -eq 1 ]] || { echo "::error::Requested agent $requested lacks one exact canonical card"; return 64; }
  echo "ATLAS_AGENT_CARD_OK agent=$requested"
}

run_with_inactivity_watchdog() {
  : > "$LOG"
  touch "$LOG"

  "$REAL" "$@" > >(tee -a "$LOG") 2> >(tee -a "$LOG" >&2) &
  local pid=$!

  while kill -0 "$pid" 2>/dev/null; do
    sleep "$WATCH_INTERVAL"
    kill -0 "$pid" 2>/dev/null || break

    local now mtime idle
    now=$(date +%s)
    mtime=$(stat -c %Y "$LOG" 2>/dev/null || echo "$now")
    idle=$((now - mtime))

    if (( idle >= INACTIVITY_LIMIT )); then
      echo "ATLAS_PROVIDER_INACTIVITY_WATCHDOG idle_seconds=$idle limit_seconds=$INACTIVITY_LIMIT" | tee -a "$LOG" >&2
      kill -TERM "$pid" 2>/dev/null || true
      sleep 10
      if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
      wait "$pid" 2>/dev/null || true
      return 124
    fi
  done

  wait "$pid"
}

round_delay() {
  local n="$1" delay="$BASE_RETRY_DELAY" i jitter=0
  for ((i=1; i<n; i++)); do
    delay=$((delay * 2))
    if (( delay >= MAX_RETRY_DELAY )); then delay="$MAX_RETRY_DELAY"; break; fi
  done
  if (( RETRY_JITTER > 0 )); then jitter=$((RANDOM % (RETRY_JITTER + 1))); fi
  echo $((delay + jitter))
}

args_with_model() {
  local model="$1"; shift
  local out=() skip_next=0 arg
  for arg in "$@"; do
    if (( skip_next )); then skip_next=0; continue; fi
    if [[ "$arg" == '--model' ]]; then skip_next=1; continue; fi
    case "$arg" in --model=*) continue;; esac
    out+=("$arg")
  done
  printf '%s\0' "${out[@]}" '--model' "$model"
}

model_chain_for_agent() {
  local agent="$1"
  case "$agent" in
    implementation_builder|release_integrator)
      printf '%s\n' "${ATLAS_CODING_MODEL_CHAIN:-$CODING_MODEL_CHAIN_DEFAULT}"
      ;;
    market_product_architect|api_architect|security_test_architect|functional_redteam|security_redteam)
      printf '%s\n' "${ATLAS_REASONING_MODEL_CHAIN:-$REASONING_MODEL_CHAIN_DEFAULT}"
      ;;
    *)
      printf '%s\n' "${ATLAS_REASONING_MODEL_CHAIN:-$REASONING_MODEL_CHAIN_DEFAULT}"
      ;;
  esac
}

validate_agent_registry "$@" || exit $?
agent=$(requested_agent_from_args "$@")
chain=$(model_chain_for_agent "$agent")
read -r -a models <<< "$chain"
[[ "${#models[@]}" -gt 0 ]] || { echo '::error::Atlas model chain is empty'; exit 64; }

echo "ATLAS_MODEL_CHAIN agent=${agent:-unknown} models=${models[*]} rounds=$MAX_ROUNDS"

round=1
while (( round <= MAX_ROUNDS )); do
  model_index=0
  for model in "${models[@]}"; do
    model_index=$((model_index + 1))
    echo "ATLAS_MODEL_ATTEMPT round=$round/$MAX_ROUNDS model=$model position=$model_index/${#models[@]}"

    mapfile -d '' -t run_args < <(args_with_model "$model" "$@")
    set +e
    run_with_inactivity_watchdog "${run_args[@]}"
    rc=$?
    set -e

    restore_control_plane

    if [[ "$rc" -eq 0 ]]; then
      echo "ATLAS_OPENCODE_OK agent=${agent:-unknown} model=$model round=$round"
      exit 0
    fi

    if [[ "$rc" -eq 124 ]] || grep -Eiq "$TRANSIENT_RE" "$LOG"; then
      echo "ATLAS_MODEL_TRANSIENT_FAILURE agent=${agent:-unknown} model=$model round=$round rc=$rc" >&2
      if (( model_index < ${#models[@]} )); then
        echo "::warning::Model/provider route failed transiently; switching immediately to next Atlas fallback model."
        continue
      fi
      break
    fi

    echo "::error::OpenCode failed with a non-transient signature agent=${agent:-unknown} model=$model rc=$rc"
    exit "$rc"
  done

  if (( round < MAX_ROUNDS )); then
    delay=$(round_delay "$round")
    echo "::warning::All Atlas models failed in round $round; retrying full model chain after ${delay}s."
    sleep "$delay"
  fi
  round=$((round + 1))
done

echo "ATLAS_MODEL_CHAIN_EXHAUSTED agent=${agent:-unknown} models=${models[*]}" >&2
exit 75
