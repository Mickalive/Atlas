#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "::error::ATLAS_CONTROL_PLANE_FAIL $*" >&2
  exit 1
}

FACTORY='.github/workflows/atlas-factory.yml'
CI='.github/workflows/atlas-main-ci.yml'
RETRY='.github/scripts/run-opencode-with-retry.sh'
INSTALL='.github/scripts/install-opencode-with-retry.sh'
HOUSEKEEPING='.github/scripts/atlas-housekeeping.sh'
STATE='state/factory_direction.json'
REGISTRY='docs/agents/AGENT_CARDS.md'
AGENT='.opencode/agents/release_integrator.md'

for f in "$FACTORY" "$CI" "$RETRY" "$INSTALL" "$HOUSEKEEPING" "$STATE" "$REGISTRY" "$AGENT"; do
  [[ -f "$f" ]] || fail "missing $f"
done

[[ ! -e '.github/workflows/atlas-factory-supervisor.yml' ]] || fail 'obsolete supervisor workflow still exists'
[[ ! -e '.github/workflows/atlas-watchdog.yml' ]] || fail 'obsolete watchdog workflow still exists'

workflow_count=$(find .github/workflows -maxdepth 1 -type f -name '*.yml' | wc -l | tr -d ' ')
[[ "$workflow_count" -eq 2 ]] || fail "expected exactly 2 workflows, found $workflow_count"

grep -Fq "cron: '*/5 * * * *'" "$FACTORY" || fail 'factory is not the five-minute heartbeat'
grep -Fq 'group: atlas-product-factory' "$FACTORY" || fail 'factory concurrency group missing'
grep -Fq 'cancel-in-progress: false' "$FACTORY" || fail 'factory may cancel its own active cycle'
grep -Fq 'bash .github/scripts/atlas-housekeeping.sh' "$FACTORY" || fail 'factory does not clean obsolete automation history'
grep -Fq 'bash .github/scripts/install-opencode-with-retry.sh' "$FACTORY" || fail 'factory lost resilient OpenCode installer'
grep -Fq 'run-opencode-with-retry.sh run' "$FACTORY" || fail 'factory lost bounded OpenCode retry wrapper'
grep -Fq -- '--agent release_integrator' "$FACTORY" || fail 'factory does not use sole canonical product worker'
grep -Fq 'WAITING_FORGE_CREDENTIALS_NO_OX_CALL' "$FACTORY" || fail 'credential-wait mode can still waste Ox calls'
grep -Fq 'ATLAS_FORGE_REGISTRATION=PERSISTED' "$FACTORY" || fail 'Forge registration id is not persisted before deploy'

for obsolete in 'api_architect' 'market_product_architect' 'security_test_architect' 'implementation_builder' 'functional_redteam' 'security_redteam' 'factory/continuation' '/candidate'; do
  if grep -Fq "$obsolete" "$FACTORY"; then
    fail "factory still contains obsolete layer: $obsolete"
  fi
done

agent_files=$(find .opencode/agents -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')
[[ "$agent_files" -eq 1 ]] || fail "expected one OpenCode agent, found $agent_files"
card_count=$(grep -Fc '<!-- AGENT_CARD: release_integrator ' "$REGISTRY" || true)
[[ "$card_count" -eq 1 ]] || fail "release_integrator card count=$card_count expected=1"
all_cards=$(grep -Fc '<!-- AGENT_CARD:' "$REGISTRY" || true)
[[ "$all_cards" -eq 1 ]] || fail "expected one canonical agent card, found $all_cards"

for sig in 'unexpected server error' 'endpoint is unavailable' 'upstream request failed' 'UnknownError'; do
  grep -Fiq "$sig" "$RETRY" || fail "retry wrapper lost transient Ox signature: $sig"
done
grep -Fq 'ATLAS_TRANSIENT_OX_INSTALL_EXHAUSTED' "$INSTALL" || fail 'installer lacks explicit transient failure marker'

grep -Fq '.github/workflows/atlas-factory.yml' "$HOUSEKEEPING" || fail 'housekeeping lost factory allowlist'
grep -Fq '.github/workflows/atlas-main-ci.yml' "$HOUSEKEEPING" || fail 'housekeeping lost CI allowlist'

jq -e '.release_status and (.continue|type=="boolean") and .reason and .next_focus and .updated_at' "$STATE" >/dev/null || fail 'invalid factory_direction.json schema'
jq -e '.release_status=="BUILDING" or .release_status=="PARITY_READY_AWAITING_CREDENTIALS" or .release_status=="LIVE_DEV_VERIFIED" or .release_status=="MARKETPLACE_READY" or .release_status=="BLOCKED_HUMAN"' "$STATE" >/dev/null || fail 'unknown release_status'
jq -e 'if .release_status=="MARKETPLACE_READY" then .continue==false else .continue==true end' "$STATE" >/dev/null || fail 'invalid continue flag for release status'
if [[ "$(jq -r '.release_status' "$STATE")" != 'MARKETPLACE_READY' ]]; then
  test -n "$(jq -r '.next_focus // empty' "$STATE")" || fail 'unfinished state lacks next_focus'
fi

echo 'ATLAS_CONTROL_PLANE=PASS'
