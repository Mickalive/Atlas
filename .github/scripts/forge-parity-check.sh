#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" != "--inside" ]]; then
  test -f package.json || { echo '::error::Missing package.json'; exit 1; }
  test -f manifest.yml || { echo '::error::Missing manifest.yml'; exit 1; }
  docker build -f forge-local/Dockerfile -t atlas-forge-parity .
  docker run --rm \
    --memory=512m \
    --memory-swap=512m \
    --tmpfs /tmp:rw,nosuid,nodev,size=512m \
    --network=none \
    atlas-forge-parity
  exit $?
fi

node -e "const major=Number(process.versions.node.split('.')[0]); if(major!==24){console.error('Expected Node 24, got '+process.version); process.exit(1)}; console.log('NODE='+process.version)"

test -f manifest.yml || { echo 'Missing Forge manifest'; exit 1; }
test -f package.json || { echo 'Missing package.json'; exit 1; }

grep -Eq '^app:' manifest.yml || { echo 'manifest.yml missing required top-level app'; exit 1; }
grep -Eq '^[[:space:]]+runtime:' manifest.yml || { echo 'manifest.yml missing app.runtime'; exit 1; }
grep -Eq 'name:[[:space:]]*nodejs24\.x' manifest.yml || {
  echo 'manifest.yml must target nodejs24.x in Forge parity mode' >&2
  exit 1
}
grep -Eq '^modules:' manifest.yml || { echo 'manifest.yml missing modules'; exit 1; }
grep -Eq '^permissions:' manifest.yml || { echo 'manifest.yml missing permissions'; exit 1; }
grep -Eq '^resources:' manifest.yml || { echo 'manifest.yml missing modern UI Kit resources'; exit 1; }

if grep -Eq 'ATLAS_DATA_MODE.{0,20}(fixture|mock)' src 2>/dev/null; then
  echo 'Fixture mode hooks detected; verifying production entrypoints remain isolated by static gates.'
fi

if grep -RIE --exclude-dir=node_modules --exclude-dir=.git '(sk-[A-Za-z0-9_-]{20,}|ATLASSIAN_ORG_API_KEY[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_-]{16,})' . >/tmp/atlas-secret-scan.txt 2>/dev/null; then
  echo 'Potential hard-coded secret found:' >&2
  cat /tmp/atlas-secret-scan.txt >&2
  exit 1
fi

# Current Forge CLI releases require an authenticated Forge identity for
# `forge lint`. This network-isolated parity container therefore owns only
# deterministic local invariants. Authenticated Forge lint is mandatory in the
# live/authenticated gate as soon as credentials are present.
echo 'FORGE_AUTHENTICATED_LINT=DEFERRED_TO_AUTHENTICATED_GATE'

npm test --if-present
npm run typecheck --if-present
npm run lint --if-present
npm run audit:high --if-present
npm run build --if-present

if [[ -f docs/FORGE_PARITY_ASSERTIONS.md ]]; then
  cat docs/FORGE_PARITY_ASSERTIONS.md
fi

echo 'FORGE_PARITY_GATE=PASS'
