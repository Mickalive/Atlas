# Atlas factory + release audit — 2026-08-26

## Verdict

The accepted product on `main` remains intact and has been revalidated independently of OpenCode. The factory/control-plane defects that caused cycles 12 and 13 to fail have been corrected. Atlas remains `PARITY_READY_AWAITING_CREDENTIALS`: the next unresolved release gate is authenticated Forge deployment/install on a real Atlassian development site.

## What failed

### 1. Ox provider failures were misclassified

Observed production factory errors included:
- `Upstream request failed: Endpoint is unavailable.`
- `UnknownError`
- `Unexpected server error. Check server logs for details.`

The old retry regex did not classify these provider-side failures as transient, so jobs could stop after the first error and the external watchdog could mistake infrastructure failure for product failure.

**Repair:** both the in-job wrapper and the external watchdog now recognize these exact signatures plus 429/5xx/network/runner failures. The wrapper retries before failing and emits stable transient markers; the watchdog runs every five minutes and can rerun failed jobs up to the bounded GitHub-attempt cap.

### 2. OpenCode installation itself had no shared resilient path

Factory jobs installed OpenCode with one-shot shell steps. An installer/network failure could therefore abort a lane before the agent retry wrapper existed.

**Repair:** every factory OpenCode installation now uses `.github/scripts/install-opencode-with-retry.sh`; exhaustion emits `ATLAS_TRANSIENT_OX_INSTALL_EXHAUSTED`, recognized by the watchdog.

### 3. Direct factory cron bypassed accepted `continue=false`

The product factory had its own six-hour schedule. This could start fresh expensive cycles despite `state/factory_direction.json` explicitly recording `continue=false` after a parity-ready release.

**Repair:** the product factory has no direct cron. Autonomous continuation belongs to the state-aware Supervisor only; explicit manual dispatch / `.factory/KICKOFF` remain available.

### 4. Supervisor state retrieval was not fail-closed enough

An unreadable/malformed state must never be interpreted as permission to continue.

**Repair:** the Supervisor refuses autonomous dispatch when the accepted state is unreadable or structurally invalid and checks `continue=false` before considering any relaunch.

### 5. Failed Release Integrator could still publish a `candidate` branch

Cycle 12 demonstrates why this is dangerous: the integrator made useful changes but also introduced a hanging test and then suffered an Ox provider failure. The previous `if: always()` persist step still saved that failed working tree as the cycle candidate.

**Repair:** the canonical candidate branch is now persisted only under `if: success()` after continuation validation, hard host gates and Forge parity have passed. Failed integration work remains observable in logs but is not promoted as a vetted candidate.

### 6. Forge registration detection was wrong for the actual manifest

The accepted `manifest.yml` currently has no `app.id`. The old live gate only registered the app when it saw particular placeholder strings, so a first real credentialed deploy could skip `forge register` and fail later.

**Repair:** the live gate treats a missing real `ari:cloud:ecosystem::app/...` id as registration-required, requires `FORGE_DEVELOPER_SPACE_ID`, runs `forge register`, then authenticated `forge lint`, development deploy and Jira install.

### 7. Live success could be overstated without a target site

Forge credentials without `ATLASSIAN_SITE` are insufficient evidence that the app has actually been installed on Jira.

**Repair:** the live gate requires Forge credentials and `ATLASSIAN_SITE` before it can claim live success. Only successful lint + deploy + install advances state to `LIVE_DEV_VERIFIED`.

## New machine-enforced invariants

`.github/scripts/control-plane-check.sh` fails if any of the following regress:
- direct cron returns to the product factory;
- watchdog is not scheduled every five minutes;
- Supervisor stops being fail-closed;
- a factory OpenCode install bypasses the retrying installer;
- observed Ox transient signatures disappear from either recovery layer;
- a failed integration can publish the canonical candidate;
- live gate loses missing-app-id registration handling;
- continuation state is invalid;
- agent definitions and canonical cards stop matching one-to-one.

The factory runs this guard before any architect lane.

## Deterministic product validation (independent of Ox)

`Atlas Main Deterministic Audit` run `33006894913` completed successfully against the accepted product/control-plane revision.

Verified:
- control-plane static audit: PASS;
- `npm ci`: PASS;
- unit/integration tests: **127/127 across 15 files**;
- TypeScript typecheck: PASS;
- static security/product gates: PASS;
- build gate: PASS;
- Forge parity container: PASS (Node 24, 512 MB, network disabled).

The test suite includes false-positive matrix, production-shaped transport parity, org-evidence precedence, partial-scan behavior, pagination truncation, pricing golden vectors, export hygiene, scan lease/concurrency mitigation, tenant isolation, logging scrubbing, population totals, provenance UI and a 60k-user / 120k-activity memory-ceiling scenario.

Static gates prove the nine declared scopes equal the reviewed budget and every scope is exercised by a real gateway call site. Production entrypoints cannot import sample transport; core logic is transport/mode-pure; secret-pattern scan is clean.

## Product integrity after control-plane repair

Compared with accepted Forge-gate commit `0a79656405a2a26bf2f360c933ab131cdf5b326f`, the audit/hardening commits modify only:
- `.github/scripts/**` control/recovery helpers;
- `.github/workflows/**` control plane + deterministic CI;
- `.gitignore`;
- factory documentation.

No `src/**`, `test/**`, `manifest.yml`, pricing engine, risk engine or product behavior was replaced by the failed cycle-12 candidate. The accepted product code therefore remains the previously audited 127-test release candidate.

## Residuals / things not honestly certifiable yet

### Live Atlassian behavior — BLOCKED ON CREDENTIALS

Still unverified until authenticated live gate:
- actual accepted scopes/consent screen;
- `asApp()` endpoint permissions on the target site;
- live pagination response shapes;
- tenant context stability between resolver and scheduled trigger;
- non-admin resolver reachability;
- real Forge KVS concurrency semantics;
- end-to-end real-site savings against manual spot checks.

This is why status remains `PARITY_READY_AWAITING_CREDENTIALS`, not `LIVE_DEV_VERIFIED`.

### Dependency supply chain — WATCH

Current `npm ci` reports **8 moderate-severity vulnerabilities** in the dependency tree plus peer-dependency warnings involving transitive Atlaskit/React packages. It also reports pending install-script review for `esbuild@0.28.2` and `iframe-resizer@4.4.5`.

These warnings did not break tests, typecheck, static gates, build or parity. Do **not** apply `npm audit fix --force` blindly: a breaking transitive upgrade could damage Forge/Atlaskit compatibility. Review production-impacting advisories deliberately and prefer upstream-compatible dependency updates.

### Repository controls — MANUAL SECURITY RESIDUAL

The repository is currently publicly visible. GitHub rulesets query returned none. Branch-protection state could not be read through the installed connector (403), so it is not certified by this audit.

If the repository is intended to contain private product work, changing visibility and configuring branch/ruleset protection are repository-administration actions outside the currently exposed connector mutation surface.

### Organization API smoke endpoint — DEPRECATION WATCH

The optional organization-admin smoke test is separate from V1 product authentication and must never be interpreted as proof of Marketplace-compliant org-wide access. Keep this endpoint/version under review as Atlassian evolves the Admin API.

## Current operational model

1. `main` changes are validated deterministically without Ox.
2. Product factory starts only by explicit request or accepted Supervisor continuation.
3. In-job Ox transient failures retry locally.
4. If exhausted, stable markers reach the five-minute watchdog.
5. Watchdog retries only defensible infrastructure failures and remains bounded.
6. Deterministic product/test failures are not hidden by retries.
7. Only gate-clean integration can create the vetted candidate.
8. Only authenticated Forge lint + deploy + Jira install can advance to `LIVE_DEV_VERIFIED`.

## Current release state

`PARITY_READY_AWAITING_CREDENTIALS` — parity-clean, deterministic suite green, live Atlassian install still required.
