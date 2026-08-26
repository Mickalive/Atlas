#!/usr/bin/env bash
set -uo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
KEEP_RUNS_PER_WORKFLOW="${ATLAS_KEEP_RUNS_PER_WORKFLOW:-8}"
KEEP_FACTORY_BRANCH_SETS="${ATLAS_KEEP_FACTORY_BRANCH_SETS:-2}"

ALLOWED_WORKFLOWS=(
  ".github/workflows/atlas-factory.yml"
  ".github/workflows/atlas-factory-supervisor.yml"
  ".github/workflows/atlas-watchdog.yml"
  ".github/workflows/atlas-main-ci.yml"
)

is_allowed_workflow() {
  local candidate="$1"
  local allowed
  for allowed in "${ALLOWED_WORKFLOWS[@]}"; do
    [[ "$candidate" == "$allowed" ]] && return 0
  done
  return 1
}

warn() {
  echo "::warning::$*"
}

echo "ATLAS_HOUSEKEEPING=START"

# Disable stale workflow registrations. Deleted workflow files can remain visible
# in Actions history; they must never stay active beside the canonical four.
while IFS=$'\t' read -r workflow_id workflow_path workflow_state; do
  [[ -n "${workflow_id:-}" ]] || continue
  if ! is_allowed_workflow "$workflow_path"; then
    echo "ATLAS_HOUSEKEEPING=OBSOLETE_WORKFLOW id=$workflow_id path=$workflow_path state=$workflow_state"
    if [[ "$workflow_state" == "active" ]]; then
      gh api --method PUT "repos/${REPO}/actions/workflows/${workflow_id}/disable" >/dev/null \
        || warn "Could not disable obsolete workflow $workflow_id ($workflow_path)"
    fi
  fi
done < <(gh api "repos/${REPO}/actions/workflows?per_page=100" --jq '.workflows[] | [.id,.path,.state] | @tsv' 2>/dev/null || true)

RUNS_JSON=$(gh api "repos/${REPO}/actions/runs?per_page=100" 2>/dev/null || echo '{"workflow_runs":[]}')

# Delete completed runs belonging to obsolete workflow definitions.
while read -r run_id; do
  [[ -n "$run_id" ]] || continue
  echo "ATLAS_HOUSEKEEPING=DELETE_OBSOLETE_RUN id=$run_id"
  gh api --method DELETE "repos/${REPO}/actions/runs/${run_id}" >/dev/null \
    || warn "Could not delete obsolete workflow run $run_id"
done < <(
  jq -r --argjson allowed '[".github/workflows/atlas-factory.yml",".github/workflows/atlas-factory-supervisor.yml",".github/workflows/atlas-watchdog.yml",".github/workflows/atlas-main-ci.yml"]' '
    .workflow_runs[]?
    | select(.status == "completed")
    | select(.path as $p | ($allowed | index($p) | not))
    | .id
  ' <<<"$RUNS_JSON" 2>/dev/null || true
)

# Keep only a short diagnostic tail for each canonical workflow. Historical
# commits and release docs remain the durable record; old Actions executions do
# not participate in control decisions and should not accumulate indefinitely.
for workflow_path in "${ALLOWED_WORKFLOWS[@]}"; do
  while read -r run_id; do
    [[ -n "$run_id" ]] || continue
    echo "ATLAS_HOUSEKEEPING=PRUNE_CANONICAL_RUN id=$run_id path=$workflow_path"
    gh api --method DELETE "repos/${REPO}/actions/runs/${run_id}" >/dev/null \
      || warn "Could not prune canonical workflow run $run_id"
  done < <(
    jq -r --arg path "$workflow_path" --argjson keep "$KEEP_RUNS_PER_WORKFLOW" '
      [.workflow_runs[]? | select(.path == $path and .status == "completed")]
      | sort_by(.created_at) | reverse
      | .[$keep:][]?.id
    ' <<<"$RUNS_JSON" 2>/dev/null || true
  )
done

# Preserve every active factory run plus the newest completed factory runs so a
# very recent failed snapshot remains inspectable/salvageable. All older
# numeric factory branches are disposable execution scratch. factory/continuation
# is intentionally non-numeric and therefore never selected for deletion.
declare -A PROTECTED_FACTORY_IDS=()
while read -r run_id; do
  [[ -n "$run_id" ]] && PROTECTED_FACTORY_IDS["$run_id"]=1
done < <(
  jq -r '
    .workflow_runs[]?
    | select(.path == ".github/workflows/atlas-factory.yml" and .status != "completed")
    | .id
  ' <<<"$RUNS_JSON" 2>/dev/null || true
)
while read -r run_id; do
  [[ -n "$run_id" ]] && PROTECTED_FACTORY_IDS["$run_id"]=1
done < <(
  jq -r --argjson keep "$KEEP_FACTORY_BRANCH_SETS" '
    [.workflow_runs[]?
      | select(.path == ".github/workflows/atlas-factory.yml" and .status == "completed")]
    | sort_by(.created_at) | reverse
    | .[:$keep][]?.id
  ' <<<"$RUNS_JSON" 2>/dev/null || true
)

while read -r branch; do
  [[ -n "$branch" ]] || continue
  if [[ "$branch" =~ ^factory/([0-9]+)/ ]]; then
    run_id="${BASH_REMATCH[1]}"
    if [[ -n "${PROTECTED_FACTORY_IDS[$run_id]:-}" ]]; then
      echo "ATLAS_HOUSEKEEPING=PRESERVE_RECENT_FACTORY_BRANCH branch=$branch"
      continue
    fi
    echo "ATLAS_HOUSEKEEPING=DELETE_FACTORY_BRANCH branch=$branch"
    gh api --method DELETE "repos/${REPO}/git/refs/heads/${branch}" >/dev/null \
      || warn "Could not delete stale factory branch $branch"
  elif [[ "$branch" == "cleanup-scratch" ]]; then
    echo "ATLAS_HOUSEKEEPING=DELETE_SCRATCH_BRANCH branch=$branch"
    gh api --method DELETE "repos/${REPO}/git/refs/heads/${branch}" >/dev/null \
      || warn "Could not delete cleanup scratch branch"
  fi
done < <(gh api --paginate "repos/${REPO}/branches?per_page=100" --jq '.[].name' 2>/dev/null || true)

echo "ATLAS_HOUSEKEEPING=DONE"
exit 0
