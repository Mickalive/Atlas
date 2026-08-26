# ATLAS — SECURITY & TEST PLAN (LEAST PRIVILEGE + FALSE-POSITIVE MATRIX)

Status: BINDING for `implementation_builder`, `functional_redteam`, `security_redteam`, `release_integrator`.
Owner: `security_test_architect` (canonical card, lane=SECURITY).
Authority: subordinate to `ATLAS_MASTER_PROMPT.md`, root `AGENTS.md`, `PRODUCT_CONTRACT.md`, `docs/FORGE_PARITY_MODE.md`.

This document defines the least-privilege release model and the adversarial test matrix for a real Marketplace release. Rules have stable IDs (`SEC-*`, `TEN-*`, `FIX-*`, `ERR-*`, `REM-*`, `LOG-*`, `FP-*`, `GATE-*`, `BLK-*`). Audits, CI failures and repairs must reference these IDs. Anything marked UNKNOWN stays UNKNOWN until sourced evidence replaces it.

## 0. Release blockers (non-negotiable)

The following are hard release blockers. Any one of them prevents `release_status` from leaving `BUILDING`, regardless of other quality:

- **BLK-1 False-positive removal**: any recommendation classified `SAFE NOW` for a protected account (admin, service/technical account, explicitly exempted user, never-observed-activity user, missing-activity user) or any `SAFE NOW` derived solely from absence of activity data.
- **BLK-2 Tenant leakage**: any code path where one tenant's identity, storage key, cache entry, scan result or UI view can resolve another tenant's data.
- **BLK-3 Fixture/live confusion**: any state where fixture-derived data is rendered, persisted, exported or summarized as if live, or where fixture mode can activate implicitly.
- **BLK-4 Complete label on partial data**: any scan with failed/truncated acquisition labelled complete, or savings totals presented without their coverage scope.
- **BLK-5 Scope creep**: a manifest permission with no verified, exercised justification; any speculative admin/write scope in V1.
- **BLK-6 Secret exposure**: credentials, tokens or org API keys in repo, logs, persisted state or error messages.
- **BLK-7 Invented capability**: shipped copy/UI claiming API support, product coverage or billing precision not backed by the verified feasibility map.

Red-team findings for BLK-1..7 MUST be filed as severity BLOCKER. The Release Integrator may not waive them.

## 1. Trust boundaries

1. **Installer/admin** — grants OAuth scopes at install time. Atlas trusts nothing else about them.
2. **Forge runtime** — provides per-installation tenant context and storage. Production transport is only `@forge/api` (`requestJira`, `requestConfluence`) behind the Atlas-owned gateway interface defined in `docs/FORGE_PARITY_MODE.md`.
3. **UI client** — hostile by default. Never trusted to assert its own tenant, scan id, or data mode.
4. **FixtureAtlassianGateway** — deterministic development data. Same downstream pipeline, zero production trust.
5. **Organization Admin API key** — TEST-ONLY credential per `docs/SECRETS.md` until a Marketplace-compliant production auth path is established by `docs/API_FEASIBILITY.md`.

## 2. Least-privilege model

### SEC-1 Read-only V1

V1 declares read scopes only. No mutation scope enters the manifest before a remediation design passes REM-gates (§6). If a future remediation needs writes, it ships as a separately reviewed permission increase, never bundled silently.

### SEC-2 Verified scope budget

The manifest may declare only scopes satisfying all of:

1. The exact scope string is verified against **current official Atlassian documentation** and recorded in `docs/API_FEASIBILITY.md`. Until then every scope is UNKNOWN and undeclarable.
2. A named gateway call exercises it. Zero-use scope = remove.
3. The capability it enables is on the V1 cut (inventory, groups, application/product roles, activity signals for Jira/Confluence/JSM/JPD).

Candidate capability set to verify (NOT approved strings — `api_architect` must confirm exact current identifiers):

| # | Capability needed for | Example area | Exact scope | Status |
|---|---|---|---|---|
| S-1 | Resolve licensed users, roles | Jira | TBD | UNKNOWN |
| S-2 | Group memberships (redundant-access analysis) | Jira | TBD | UNKNOWN |
| S-3 | Application access / product roles | Jira/JSM/JPD | TBD | UNKNOWN |
| S-4 | Issue/activity recency signals | Jira | TBD | UNKNOWN |
| S-5 | Space/content recency + contributors | Confluence | TBD | UNKNOWN |
| S-6 | Confluence users/groups | Confluence | TBD | UNKNOWN |
| S-7 | Identity of invoking admin (`me`) | platform | TBD | UNKNOWN |

Rules:
- **SEC-2a**: `permissions:` block in `manifest.yml` must equal the verified-and-exercised set exactly. Superset = BLK-5.
- **SEC-2b**: no egress outside Atlassian product APIs. No external LLM/SaaS calls (also enforced by network-isolated parity container).
- **SEC-2c**: Organization Admin API usage compiles only into test/smoke paths, gated behind explicit env configuration, never in the default request path.

### SEC-3 Deny-by-default data handling

Collect only: identities needed to name seats, group/role memberships, activity/recency evidence, product access. Do not collect issue bodies, page contents, attachments, personal data beyond identifiers, or billing documents. Unknown whether a field is needed ⇒ do not store it.

## 3. Tenant isolation

- **TEN-1** Tenant identity comes exclusively from server-resolved Forge context. Client-supplied tenant/cloud/site parameters are ignored for authorization decisions (they may only narrow a view after server validation).
- **TEN-2** Every persisted key is tenant-namespaced (installation-scoped). Any raw-key storage accessor must prove tenant derivation internally; direct unscoped storage APIs are forbidden to call outside the storage module.
- **TEN-3** No module-level/global mutable state survives across invocations carrying tenant data (parity rule: no cross-tenant/global mutable state). Caches, if any, are keyed by tenant and bounded.
- **TEN-4** Every read path (resolver/function) re-derives tenant from context; tests must attempt cross-tenant reads via forged/tampered parameters and prove denial.
- **TEN-5** Logs are tenant-safe: they may contain installation id and counts, not bulk user lists or activity dumps.

## 4. Fixture/live separation

- **FIX-1** Data mode is selected explicitly at process start from environment/config (`LIVE` default; `FIXTURE` requires deliberate opt-in). Auto-detection of fixture mode is forbidden.
- **FIX-2** Mode is stamped onto every scan record, every aggregate, and every recommendation object as provenance (`dataMode`). Downstream engines preserve the stamp; losing it is BLK-3.
- **FIX-3** UI must render an unmistakable non-live indicator whenever any displayed value originates from `FIXTURE` data (banner + per-card marker). A fixture-only render must survive screenshot/string assertions in tests.
- **FIX-4** Export/copy/share paths either refuse fixture-origin data or stamp it irreversibly as sample data.
- **FIX-5** Fixture responses must be shape-validated against the same TypeScript/interface contracts as production adapters (contract tests), and must flow through normalization→evidence→risk→finance→recommendation unchanged. There is no second scanner and no demo business logic (FORGE_PARITY_MODE adapter rule).
- **FIX-6** Fixture datasets live under versioned fixture files, clearly named (`fixtures/**`, `*fixture*`); no fixture literal may appear inline in engine code; a grep gate asserts engine/source trees contain no fixture literals (see GATE-4).

## 5. Partial scans, errors and unknowns

Scan result object carries: `status ∈ {COMPLETE, PARTIAL, FAILED}`, per-product coverage `{product, state: OK|DEGRADED|FAILED, reason}`, and evidence-quality flags.

- **ERR-1** Any failed/truncated acquisition forces `status=PARTIAL` (or FAILED). Savings shown for a PARTIAL scan must be labeled partial and computed only over covered populations, with visible coverage list.
- **ERR-2** Missing activity field ⇒ evidence `UNKNOWN`. It must never lower risk, never raise confidence, never produce `SAFE NOW` (also BLK-1).
- **ERR-3** 401/403 during a product scan degrades that product to FAILED/insufficient-permission; the app surfaces which permissions were missing. It must not synthesize zero-usage evidence.
- **ERR-4** 429 ⇒ exponential backoff with retry ceiling; exhaustion ⇒ PARTIAL with rate-limit reason. Retry/recovery must be covered by deterministic tests.
- **ERR-5** 5xx/timeouts ⇒ same partial semantics; no infinite retries inside function limits.
- **ERR-6** Malformed/unknown response fields are preserved as unknown, logged safely, never coerced into activity-absence.
- **ERR-7** Pagination must drain completely; aborting early (error or cap) marks affected populations PARTIAL. Truncated-inventory totals are forbidden from being presented as full-population savings.

## 6. Remediation gates (future write actions)

No remediation ships in V1 unless all hold; otherwise the feature does not ship:

- **REM-1** Separate, explicitly justified write scopes (new permission review, never piggybacked).
- **REM-2** Dry-run preview diffing exact intended change with expected financial impact.
- **REM-3** Dependency check executed at action time (not cached): group membership, last-activity refresh, protected-class screen (admins/service accounts/exemptions).
- **REM-4** Explicit human confirmation naming the target(s) and dollar impact.
- **REM-5** Append-only audit log entry (who, what, when, evidence snapshot id).
- **REM-6** Rollback path where the API technically allows it; otherwise the action is classified higher-risk and defaults to REVIEW, not SAFE NOW.
- **REM-7** Protected classes (BLK-1 list) are structurally excluded from one-click actions.

## 7. Secrets & logging

- **LOG-1** No secret material in source, fixtures, tests, logs or state. Org API key and Forge credentials exist only as GitHub Actions secrets / runtime env (`docs/SECRETS.md`).
- **LOG-2** Error/log serialization scrubs `Authorization` headers, tokens, cookies; a unit test feeds a poisoned fake response through the logger and asserts scrubbing.
- **LOG-3** Secret-scan patterns (at minimum those in `.github/scripts/forge-parity-check.sh`) pass; Builder extends patterns for `FORGE_API_TOKEN`/bearer forms.
- **LOG-4** Persisted state contains derived analytics and identifiers, never raw credentials and never full tenant activity dumps (minimal-storage rule).

## 8. False-positive test matrix (release-critical)

These cases are MANDATORY automated tests over the real downstream pipeline (fixtures through the normal gateway interface — FIX-5). Expected classifications are binding; a mismatch is a failing test, and any `SAFE NOW` where `KEEP`/`REVIEW`/`UNKNOWN` is required is BLK-1.

Threshold bands below are policy placeholders the product/architecture lane must finalize; the *structural* expectations (never SAFE on protected classes) are binding now.

| ID | Scenario (required fixture) | Required outcome |
|---|---|---|
| FP-01 | Active user, recent activity | Not in reclaimable set |
| FP-02 | 30d inactive | Band policy (≥REVIEW); never SAFE NOW below threshold |
| FP-03 | 60d inactive | Band policy per finalized thresholds |
| FP-04 | 90d inactive | May reach SAFE NOW only with corroboration rule satisfied |
| FP-05 | 180d inactive | Highest-confidence band; still subject to protected-class screens |
| FP-06 | Never-observed activity | UNKNOWN or REVIEW; NEVER SAFE NOW |
| FP-07 | Activity field missing/null | UNKNOWN evidence; NEVER SAFE NOW (BLK-1) |
| FP-08 | Site admin account | KEEP floor; excluded from SAFE NOW/remediation |
| FP-09 | Probable service/technical account (heuristic signals) | REVIEW floor; heuristic must be explainable, not opaque score |
| FP-10 | Explicitly exempted user (exception list) | Honored absolutely; appears in report as protected |
| FP-11 | Access via exactly one group | Clean single-group reclaim analysis |
| FP-12 | Redundant access via multiple groups | Deduplicated; removing one membership ≠ removing license twice; money counted once |
| FP-13 | Multi-product identity (Jira+Confluence) | Aggregated per billing identity; no double counting across products |
| FP-14 | Jira-only evidence, Confluence seat | Product-scoped claims only; no cross-product inference |
| FP-15 | JSM agent-like case | Licensed-agent semantics; customers/portals not counted as removable seats |
| FP-16 | JPD creator-like case | Role-band semantics per verified JPD model; UNKNOWN where feasibility lacks evidence |
| FP-17 | Deactivated/disabled account | Distinct class; must not claim savings if it already costs nothing |
| FP-18 | Recently created account (< min observation window) | Insufficient-evidence class |
| FP-19 | Pagination-truncated inventory | PARTIAL; totals scoped to retrieved pages with visible caveat (ERR-7) |
| FP-20 | 403 on one product mid-scan | PARTIAL + missing-permission surfacing; no fabricated zeros (ERR-3) |
| FP-21 | 429 then successful retry | COMPLETE with recovery recorded; backoff respected |
| FP-22 | 5xx repeated | PARTIAL/FAILED; clean degraded UX |
| FP-23 | Malformed activity payload | Preserved unknown; no silent inactive-default (ERR-6) |
| FP-24 | Pricing tier boundary (seat counts straddling band edges) | Tiered math correct; rounding never overstates savings |
| FP-25 | Pricing minimum/band edge cases | Minimums honored; estimate labeled with assumptions |
| FP-26 | Duplicate/inconsistent user records across endpoints | Single canonical identity or explicit UNKNOWN; no phantom extra seats |
| FP-27 | User active in one product only, seat shared across bundle | Bundle-aware math; no inflated per-seat savings |
| FP-28 | Empty tenant / zero users | Graceful zero-state; no crash, no fake total |

Additional structural assertions (test suite must enforce):
- **FP-S1** No recommendation reaches `SAFE NOW` unless evidence set satisfies the corroboration rule AND protected-class screens pass — property-tested, not example-tested.
- **FP-S2** Every emitted recommendation carries WHAT/WHY/MONEY/RISK/EVIDENCE fields; missing field = test failure.
- **FP-S3** Sum of per-item estimated savings equals displayed ESTIMATED ANNUAL SAVINGS (no hidden inflation), within documented rounding.
- **FP-S4** Rounding direction: display rounds down for savings estimates; assumptions exposed.

## 9. Adversarial security test matrix

| ID | Attack | Required defense |
|---|---|---|
| ADV-1 | Tampered UI param claiming another cloud/tenant id | Server-side tenant derivation wins (TEN-1/TEN-4); cross-tenant read denied + tested |
| ADV-2 | Storage key manipulation / path-style key injection | Keys built via typed tenant-namespaced builder; injection attempts rejected |
| ADV-3 | Forged fixture activation in prod build (env var flip) | Fixture gateway unreachable from production entrypoints; mode opt-in fails closed; test proves prod entrypoint has no fixture import path |
| ADV-4 | Fixture values leaking into exports/logs | FIX-2/FIX-4 stamps; log scrubbing test |
| ADV-5 | Oversized tenant (100k users, deep pagination) | Bounded memory within 512 MB function budget; streaming/batching; parity-container stress test |
| ADV-6 | Poisoned upstream response (huge fields, weird unicode, nested depth) | Normalizer tolerant, bounded, no crash; malformed preserved as unknown (ERR-6) |
| ADV-7 | Log injection / header reflection | LOG-2 scrubbing |
| ADV-8 | Manifest drift (scope added without code) | GATE-2 comparison fails |
| ADV-9 | Retry storm amplifying rate limits | Backoff ceilings tested (ERR-4) |
| ADV-10 | Remediation endpoint invoked directly (if ever implemented) | All REM-1..7 gates enforced server-side; protected classes rejected structurally |

## 10. Executable gates

Gates run inside the existing Node 24 / network-isolated parity container via `npm test` (already invoked by `.github/scripts/forge-parity-check.sh`), plus Builder-added scripts. All must be green before any audit cycle begins.

- **GATE-1 FP matrix suite**: automated tests implementing §8 rows + FP-S1..S4 against the real pipeline via FixtureAtlassianGateway. Exit non-zero on any deviation. File: Builder-owned (suggest `src/**/__tests__/false-positive-matrix.*`), referenced here by behavior, not path.
- **GATE-2 Scope budget check**: script comparing `manifest.yml` `permissions` against the verified allowlist from `docs/API_FEASIBILITY.md` + static analysis showing each scope's exercising call. Unverified/unexercised scope ⇒ fail (SEC-2a).
- **GATE-3 Isolation suite**: ADV-1/ADV-2 cross-tenant and key-injection tests.
- **GATE-4 Fixture hygiene**: grep/AST assertions that (a) engine/source trees contain no fixture literals (FIX-6), (b) fixture mode cannot activate without explicit config (FIX-1), (c) every persisted scan record carries `dataMode` (FIX-2).
- **GATE-5 Partial-semantics suite**: ERR-1..ERR-7 behaviors incl. pagination drain, 401/403/429/5xx fixtures, malformed payloads.
- **GATE-6 Provenance/UI suite**: fixture banner rendering (FIX-3), export stamping (FIX-4), WHAT/WHY/MONEY/RISK/EVIDENCE completeness (FP-S2).
- **GATE-7 Secret/log hygiene**: LOG-2/LOG-3 scrubbing + pattern scan.
- **GATE-8 Memory ceiling**: large-fixture stress run completing under the 512 MB parity budget (ADV-5).

Gate-to-blocker mapping: GATE-1↔BLK-1, GATE-3↔BLK-2, GATE-4/GATE-6↔BLK-3, GATE-5↔BLK-4, GATE-2↔BLK-5, GATE-7↔BLK-6, GATE-2+feasibility↔BLK-7.

## 11. UNKNOWN register (honesty ledger)

Preserved here and to be superseded item-by-item by `docs/API_FEASIBILITY.md`:

1. Exact current scope strings for capabilities S-1..S-7 — UNKNOWN.
2. Whether activity/recency signals exist for JSM/JPD at required granularity — UNKNOWN.
3. Whether Forge storage semantics suffice for retention/TTL policies — UNKNOWN until live verification.
4. Marketplace-compliant production auth for organization-level data — UNKNOWN; org API key remains test-only (SEC-2c).
5. Precise JPD/JSM role-band licensing semantics for financial math — UNKNOWN pending sourced evidence; FP-15/FP-16 must encode UNKNOWN as UNKNOWN, not guesses.

Rule: a shipped claim resting on an unresolved register entry is BLK-7.

## 12. Acceptance summary

A candidate is security/test-releasable when: GATE-1..8 pass inside the parity container; no BLK condition is reachable by construction or test; the UNKNOWN register contains no entry silently promoted to fact; and both red teams' findings against these rule IDs show no open BLOCKER/HIGH. The Release Integrator records residual risks in `state/factory_direction.json` and `docs/RELEASE_STATUS.md` — never deletes them.
