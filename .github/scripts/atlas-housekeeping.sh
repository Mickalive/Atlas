#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
CURRENT_SHA="${GITHUB_SHA:-}"
KEEP_CI_RUNS="${ATLAS_KEEP_CI_RUNS:-5}"
KEEP_FACTORY_RUNS_PER_SHA="${ATLAS_KEEP_FACTORY_RUNS_PER_SHA:-3}"

ALLOWED_WORKFLOWS=(
  '.github/workflows/atlas-factory.yml'
  '.github/workflows/atlas-main-ci.yml'
)

is_allowed_workflow() {
  local candidate="$1"
  local allowed
  for allowed in "${ALLOWED_WORKFLOWS[@]}"; do
    [[ "$candidate" == "$allowed" ]] && return 0
  done
  return 1
}

warn() { echo "::warning::$*"; }

echo 'ATLAS_HOUSEKEEPING=START'

# Deleted workflow files can remain registered in Actions. Disable every
# historical controller except the two canonical workflows.
while IFS=$'\t' read -r workflow_id workflow_path workflow_state; do
  [[ -n "${workflow_id:-}" ]] || continue
  if ! is_allowed_workflow "$workflow_path"; then
    echo "ATLAS_HOUSEKEEPING=DISABLE_OBSOLETE_WORKFLOW id=$workflow_id path=$workflow_path state=$workflow_state"
    if [[ "$workflow_state" == 'active' ]]; then
      gh api --method PUT "repos/${REPO}/actions/workflows/${workflow_id}/disable" >/dev/null \
        || warn "Could not disable obsolete workflow $workflow_id ($workflow_path)"
    fi
  fi
done < <(gh api "repos/${REPO}/actions/workflows?per_page=100" --jq '.workflows[] | [.id,.path,.state] | @tsv' 2>/dev/null || true)

RUNS_JSON=$(gh api "repos/${REPO}/actions/runs?per_page=100" 2>/dev/null || echo '{"workflow_runs":[]}')

# Remove completed runs from deleted workflows.
while read -r run_id; do
  [[ -n "$run_id" ]] || continue
  echo "ATLAS_HOUSEKEEPING=DELETE_OBSOLETE_RUN id=$run_id"
  gh api --method DELETE "repos/${REPO}/actions/runs/${run_id}" >/dev/null \
    || warn "Could not delete obsolete run $run_id"
done < <(
  jq -r --argjson allowed '[".github/workflows/atlas-factory.yml",".github/workflows/atlas-main-ci.yml"]' '
    .workflow_runs[]?
    | select(.status == "completed")
    | select(.path as $p | ($allowed | index($p) | not))
    | .id
  ' <<<"$RUNS_JSON"
)

# Old multi-lane factory executions share the same workflow path. Once the new
# factory is running on a new SHA, runs from older definitions are obsolete.
if [[ -n "$CURRENT_SHA" ]]; then
  while read -r run_id; do
    [[ -n "$run_id" ]] || continue
    echo "ATLAS_HOUSEKEEPING=DELETE_OLD_FACTORY_DEFINITION_RUN id=$run_id"
    gh api --method DELETE "repos/${REPO}/actions/runs/${run_id}" >/dev/null \
      || warn "Could not delete old factory run $run_id"
  done < <(
    jq -r --arg sha "$CURRENT_SHA" '
      .workflow_runs[]?
      | select(.path == ".github/workflows/atlas-factory.yml" and .status == "completed" and .head_sha != $sha)
      | .id
    ' <<<"$RUNS_JSON"
  )
fi

# Keep only a tiny diagnostic tail for factory runs from the current definition.
while read -r run_id; do
  [[ -n "$run_id" ]] || continue
  echo "ATLAS_HOUSEKEEPING=PRUNE_FACTORY_RUN id=$run_id"
  gh api --method DELETE "repos/${REPO}/actions/runs/${run_id}" >/dev/null \
    || warn "Could not prune factory run $run_id"
done < <(
  jq -r --arg sha "$CURRENT_SHA" --argjson keep "$KEEP_FACTORY_RUNS_PER_SHA" '
    [.workflow_runs[]?
      | select(.path == ".github/workflows/atlas-factory.yml" and .status == "completed" and (.head_sha == $sha or $sha == ""))]
    | sort_by(.created_at) | reverse
    | .[$keep:][]?.id
  ' <<<"$RUNS_JSON"
)

# CI history is useful, but only a short tail is needed.
while read -r run_id; do
  [[ -n "$run_id" ]] || continue
  echo "ATLAS_HOUSEKEEPING=PRUNE_CI_RUN id=$run_id"
  gh api --method DELETE "repos/${REPO}/actions/runs/${run_id}" >/dev/null \
    || warn "Could not prune CI run $run_id"
done < <(
  jq -r --argjson keep "$KEEP_CI_RUNS" '
    [.workflow_runs[]?
      | select(.path == ".github/workflows/atlas-main-ci.yml" and .status == "completed")]
    | sort_by(.created_at) | reverse
    | .[$keep:][]?.id
  ' <<<"$RUNS_JSON"
)

# The simplified factory never uses execution branches. Delete every historical
# factory/* branch, including continuation/candidate/lane branches.
while read -r branch; do
  [[ -n "$branch" ]] || continue
  if [[ "$branch" == factory/* || "$branch" == 'cleanup-scratch' ]]; then
    echo "ATLAS_HOUSEKEEPING=DELETE_OBSOLETE_BRANCH branch=$branch"
    gh api --method DELETE "repos/${REPO}/git/refs/heads/${branch}" >/dev/null \
      || warn "Could not delete obsolete branch $branch"
  fi
done < <(gh api --paginate "repos/${REPO}/branches?per_page=100" --jq '.[].name' 2>/dev/null || true)

echo 'ATLAS_HOUSEKEEPING=DONE'
