#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "::error::ATLAS_CONTROL_PLANE_FAIL $*" >&2
  exit 1
}

FACTORY='.github/workflows/atlas-factory.yml'
WATCHDOG='.github/workflows/atlas-watchdog.yml'
SUPERVISOR='.github/workflows/atlas-factory-supervisor.yml'
RETRY='.github/scripts/run-opencode-with-retry.sh'
INSTALL='.github/scripts/install-opencode-with-retry.sh'
STATE='state/factory_direction.json'
REGISTRY='docs/agents/AGENT_CARDS.md'

for f in "$FACTORY" "$WATCHDOG" "$SUPERVISOR" "$RETRY" "$INSTALL" "$STATE" "$REGISTRY"; do
  [[ -f "$f" ]] || fail "missing $f"
done

# The product factory itself never wakes from a blind cron. A separate
# five-minute supervisor owns continuity and a five-minute watchdog owns local
# infrastructure recovery. This keeps retries observable and prevents duplicate
# long-running factories.
if grep -Eq '^  schedule:' "$FACTORY"; then
  fail 'atlas-factory.yml contains a direct schedule; continuity must be supervisor-owned'
fi
grep -Fq "cron: '*/5 * * * *'" "$WATCHDOG" || fail 'watchdog is not scheduled every five minutes'
grep -Fq "cron: '*/5 * * * *'" "$SUPERVISOR" || fail 'continuity supervisor is not scheduled every five minutes'

# MARKETPLACE_READY is the only legal autonomous stop. Missing/corrupt state,
# deterministic failures and exhausted local retries must all converge to a
# fresh factory dispatch rather than a dead control plane.
grep -Fq "STATUS\" == 'MARKETPLACE_READY'" "$SUPERVISOR" || fail 'supervisor lacks Marketplace-ready stop condition'
grep -Fq 'ATLAS_CONTINUITY=DISPATCH_FRESH_CYCLE' "$SUPERVISOR" || fail 'supervisor lacks fresh-cycle recovery path'
grep -Fq 'supervisor will launch a fresh cycle' "$WATCHDOG" || fail 'watchdog exhaustion is not delegated to global continuity'
if grep -Eiq '(24h autonomous cycle cap|runaway busywork|RECENT.*-ge)' "$SUPERVISOR"; then
  fail 'supervisor contains a run cap that can permanently stop unfinished product work'
fi

# Every OpenCode installation in the product factory must go through the same
# retrying installer. This catches accidental return to one-shot curl steps.
install_steps=$(grep -Fc -- '- name: Install OpenCode' "$FACTORY" || true)
helper_calls=$(grep -Fc 'bash .github/scripts/install-opencode-with-retry.sh' "$FACTORY" || true)
[[ "$install_steps" -gt 0 ]] || fail 'factory contains no OpenCode install steps'
[[ "$install_steps" -eq "$helper_calls" ]] || fail "OpenCode install helper mismatch: steps=$install_steps helper_calls=$helper_calls"

# The provider signatures that broke real Atlas cycles must stay classified as
# transient in both the in-job retry wrapper and the external watchdog.
for sig in 'unexpected server error' 'endpoint is unavailable' 'upstream request failed' 'UnknownError'; do
  grep -Fiq "$sig" "$RETRY" || fail "retry wrapper lost Ox signature: $sig"
  grep -Fiq "$sig" "$WATCHDOG" || fail "watchdog lost Ox signature: $sig"
done

grep -Fq 'ATLAS_TRANSIENT_OX_INSTALL_EXHAUSTED' "$INSTALL" || fail 'installer lacks explicit transient exhaustion marker'
grep -Fq 'ATLAS_TRANSIENT_OX_INSTALL_EXHAUSTED' "$WATCHDOG" || fail 'watchdog does not recognize installer exhaustion marker'

# Failed integration attempts may be useful in logs, but only a gate-clean
# integration is allowed to create/overwrite the canonical candidate branch.
grep -Fq 'Persist vetted release candidate' "$FACTORY" || fail 'vetted candidate persist step missing'
grep -A2 -F 'Persist vetted release candidate' "$FACTORY" | grep -Fq 'if: success()' || fail 'candidate branch can be persisted after failed gates'

# The live gate must register an unregistered manifest, not merely look for one
# particular historical placeholder spelling.
grep -Fq 'ATLAS_FORGE_REGISTRATION_REQUIRED' "$FACTORY" || fail 'live gate lacks missing-app-id registration path'

# Accepted continuation state must be structurally valid, and unfinished work
# must remain continuable. Only MARKETPLACE_READY may set continue=false.
jq -e '.release_status and (.continue|type=="boolean") and .reason and .next_focus and .updated_at' "$STATE" >/dev/null || fail 'invalid factory_direction.json schema'
jq -e '.release_status=="BUILDING" or .release_status=="PARITY_READY_AWAITING_CREDENTIALS" or .release_status=="LIVE_DEV_VERIFIED" or .release_status=="MARKETPLACE_READY" or .release_status=="BLOCKED_HUMAN"' "$STATE" >/dev/null || fail 'unknown release_status'
jq -e 'if .release_status=="MARKETPLACE_READY" then .continue==false else .continue==true end' "$STATE" >/dev/null || fail 'unfinished product state is allowed to stop autonomous continuation'
if [[ "$(jq -r '.release_status' "$STATE")" != 'MARKETPLACE_READY' ]]; then
  test -n "$(jq -r '.next_focus // empty' "$STATE")" || fail 'unfinished product state lacks next_focus'
fi

# One exact card per OpenCode agent, and no orphan cards.
bad=0
while IFS= read -r file; do
  id="${file#.opencode/agents/}"; id="${id%.md}"
  count=$(grep -Fc "<!-- AGENT_CARD: ${id} " "$REGISTRY" || true)
  if [[ "$count" -ne 1 ]]; then
    echo "::error::Agent $id has $count canonical cards; expected 1" >&2
    bad=1
  fi
done < <(find .opencode/agents -type f -name '*.md' | sort)
while IFS= read -r id; do
  [[ -f ".opencode/agents/${id}.md" ]] || { echo "::error::Orphan agent card $id" >&2; bad=1; }
done < <(grep '^<!-- AGENT_CARD:' "$REGISTRY" | awk '{print $3}')
[[ "$bad" -eq 0 ]] || fail 'agent registry mismatch'

echo 'ATLAS_CONTROL_PLANE=PASS'
