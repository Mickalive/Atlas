# ATLAS — SECURITY TEST PLAN

Status: EXECUTABLE, BINDING.  
Owner: `security_test_architect`  
Last updated: 2026-08-27  
Test suite: `test/*.test.ts` (Vitest, 15 files, 127+ assertions as of run `33067877466`)

---

## 0. Purpose

This document defines the **adversarial, security, tenancy, false-positive, permissions, secret, partial-scan, and fixture/live release requirements** that must hold before any Atlas code path is trusted. Every § maps to concrete executable test(s). A new requirement without a test is a blocker; a passing test without a requirement is removed.

---

## 1. False-Positive Elimination (BLK-1 class)

False-positive removal recommendations are the worst product failure. Atlas must never classify an active, needed, or uncertain user as SAFE NOW.

### 1.1 Structural invariants (FP-S1..S4)

| ID | Rule | Test |
|----|------|------|
| FP-S1 | SAFE_NOW requires CORROBORATION_RULE=PASS and zero protected-class FAILs (ADMIN_LIKE, SERVICE_ACCOUNT, EXCEPTION_LIST) | `false-positive-matrix.test.ts` → `FP-S1` |
| FP-S2 | Every emitted card carries WHAT/WHY/MONEY/RISK/EVIDENCE with non-empty fields and valid ruleId prefix | `false-positive-matrix.test.ts` → `FP-S2` |
| FP-S3 | Displayed hero = exact-sum-rounded-down-once; per-item floors never exceed hero | `false-positive-matrix.test.ts` → `FP-S3` |
| FP-S4 | No rounding path may round savings UP | `false-positive-matrix.test.ts` → `FP-S4`, `pricing.golden.test.ts` → `rounding policy` |

### 1.2 Account classification matrix (FP-01..FP-18)

Each row is a **binding** expected classification. Any regression to SAFE_NOW where KEEP/REVIEW/UNKNOWN is required is BLK-1.

| ID | Scenario | Expected Class | Test |
|----|----------|---------------|------|
| FP-01 | Active user | KEEP | `false-positive-matrix.test.ts` |
| FP-02 | 30d inactive, single surface | KEEP or REVIEW or UNKNOWN, never SAFE_NOW | `false-positive-matrix.test.ts` |
| FP-03 | 60d inactive, single surface | KEEP or REVIEW or UNKNOWN, never SAFE_NOW | `false-positive-matrix.test.ts` |
| FP-04 | 95d inactive, single surface | REVIEW at most | `false-positive-matrix.test.ts` |
| FP-05 | 180d+ inactive across two surfaces with full coverage | SAFE_NOW (highest-confidence band) | `false-positive-matrix.test.ts` |
| FP-06 | Never-observed activity with provable window coverage | SAFE_NOW, ruleId=RULE_CORROBORATED_ABSENCE | `false-positive-matrix.test.ts` |
| FP-07 | Missing/null activity field | UNKNOWN, never SAFE_NOW | `false-positive-matrix.test.ts` |
| FP-08 | Admin-like group membership | REVIEW floor, excluded from SAFE_NOW | `false-positive-matrix.test.ts` |
| FP-09 | Probable service account (heuristic) | REVIEW floor, SERVICE_ACCOUNT_HEURISTIC=FAIL | `false-positive-matrix.test.ts` |
| FP-10 | Explicit exception list member | REVIEW floor, ruleId ends `_PROTECTED` | `false-positive-matrix.test.ts` |
| FP-11 | Single-group seat, one access path | Clean analysis, one jira access path | `false-positive-matrix.test.ts` |
| FP-12 | Redundant multi-group access | Deduplicated, money counted once | `false-positive-matrix.test.ts` |
| FP-14 | Jira-only evidence, Confluence seat held | Product-scoped claim only | `false-positive-matrix.test.ts` |
| FP-15 | JSM agent-like case | Analyzed as licensed agent semantics | `false-positive-matrix.test.ts` |
| FP-16 | JPD creator-like case | Plan shown, NO JPD seat savings claimed | `false-positive-matrix.test.ts` |
| FP-17 | Deactivated account | KEEP, zero savings, excluded from totals | `false-positive-matrix.test.ts` |
| FP-18 | Recently created account (< window) | UNKNOWN, ruleId=RULE_INSUFFICIENT_OBSERVATION | `false-positive-matrix.test.ts` |
| FP-26 | Duplicate identity records | Collapse to one canonical user | `false-positive-matrix.test.ts` |
| FP-28 | Empty tenant | Graceful zero state, no crash, no fake totals | `false-positive-matrix.test.ts` |

### 1.3 Conflicting recent signal (BLOCKER 2 class)

Fresh product-specific org activity must override stale org-wide last-active. A <90d merged org observation forces KEEP regardless of other stale surfaces.

| ID | Rule | Test |
|----|------|------|
| ORG-M1 | mergedOrgLastActiveForProduct takes MAX recency, never positional first | `org-evidence.test.ts` |
| ORG-M2 | <90d product-specific org observation forces KEEP via conflicting-recent screen | `org-evidence.test.ts` → `BLOCKER 2 end-to-end` |
| ORG-M3 | Classifier precedence: conflicting-recent runs BEFORE staleness corroboration | `org-evidence.test.ts` → `classifier precedence` |

---

## 2. Tenant Isolation (TEN-1..TEN-5)

### 2.1 Storage key injection defense

| ID | Rule | Test |
|----|------|------|
| ADV-2 | Storage keys reject traversal patterns (`../`, `\`, `${}`, `;`, spaces) | `isolation.test.ts` → `ADV-2` |
| ADV-2b | Storage keys reject oversized components (>200 chars) | `isolation.test.ts` → `ADV-2` |
| TEN-4a | Keys always prefixed with captured installationId in strict shape | `isolation.test.ts` → `TEN-2/TEN-4` |

### 2.2 Namespace isolation

| ID | Rule | Test |
|----|------|------|
| TEN-2 | Different installationIds produce different key namespaces | `isolation.test.ts` → `TEN-2/TEN-4` |
| TEN-4 | Memory-backed scoped storage isolates records between tenants | `isolation.test.ts` → `TEN-2/TEN-4` |

### 2.3 Tenant derivation

| ID | Rule | Test |
|----|------|------|
| TEN-1 | Server-side tenant derivation wins; installationId preferred over cloudId | `isolation.test.ts` → `TEN-1/ADV-1` |
| ADV-1 | Refuses to serve without server-resolved identity even if payload claims one | `isolation.test.ts` → `TEN-1/ADV-1` |

### 2.4 Scan concurrency lease

| ID | Rule | Test |
|----|------|------|
| SEC-H2 | Foreign unexpired lease blocks advancement, prevents duplicate appends | `scan-lease.test.ts` |
| SEC-H2b | Expired foreign lease is taken over (crashed invocations cannot wedge scans) | `scan-lease.test.ts` |
| SEC-H2c | Terminal states release the lease for subsequent scans | `scan-lease.test.ts` |
| SEC-H2d | Sequential chunks from same service renew own lease, no self-blocking | `scan-lease.test.ts` |

**Residual (honest):** Forge KVS consistency under concurrent put/get is UNKNOWN until live semantics are observed. The lease narrows the race window but does not prove mutual exclusion. Recorded in `docs/RELEASE_STATUS.md`.

---

## 3. Permissions and Graceful Degradation (ERR-1..ERR-7)

### 3.1 Retry and backoff

| ID | Rule | Test |
|----|------|------|
| ERR-4 | Retry-After header honored as floor for delay | `gateway-pacing-errors.test.ts` |
| ERR-4b | Exponential backoff within jitter bounds, never exceeds maxDelayMs | `gateway-pacing-errors.test.ts` |
| ERR-4c | Deterministic under fixed seed | `gateway-pacing-errors.test.ts` |

### 3.2 Non-retryable errors

| ID | Rule | Test |
|----|------|------|
| ERR-1 | 401/403 never retried; classified as permission-partial | `gateway-pacing-errors.test.ts` |
| ERR-2 | Other 4xx never retried | `gateway-pacing-errors.test.ts` |
| ERR-3 | Stops after attempt ceiling, no infinite loop | `gateway-pacing-errors.test.ts` |

### 3.3 Adapter-level error classification

| ID | Rule | Test |
|----|------|------|
| ERR-6 | Malformed bodies marked malformed, not empty-ok | `gateway-pacing-errors.test.ts` |
| ERR-6b | 403 mapped to permission-degraded outcome, null value | `gateway-pacing-errors.test.ts` |
| ERR-6c | 429 surfaces rate-limit metadata (retryAfterSec, reason) | `gateway-pacing-errors.test.ts` |

### 3.4 Gateway pacing integration

| ID | Rule | Test |
|----|------|------|
| GATE-5a | 429 retry then success: gateway returns valid outcome | `gateway-pacing-errors.test.ts` → `production gateway` |
| GATE-5b | Persistent 5xx: exhausts retries, returns last outcome | `gateway-pacing-errors.test.ts` |
| GATE-5c | Interactive fallback: falls back to asUser after 401 when enabled | `gateway-pacing-errors.test.ts` |
| GATE-5d | Default identity mode: fail-closed, no asUser fallback | `gateway-pacing-errors.test.ts` |

---

## 4. Secret Handling (LOG-1..LOG-2)

### 4.1 Log scrubbing

| ID | Rule | Test |
|----|------|------|
| LOG-2a | Sensitive keys redacted recursively (authorization, headers, api_key, apiKey, cookie) | `logger-scrub.test.ts` |
| LOG-2b | Bearer-shaped string values redacted even under innocent keys | `logger-scrub.test.ts` |
| LOG-2c | Depth and array size bounds prevent poisoned payloads flooding logs | `logger-scrub.test.ts` |
| LOG-2d | Never emits raw credentials in meta fields (error/info paths) | `logger-scrub.test.ts` → `logger output hygiene` |
| LOG-2e | Bearer-shaped credentials interpolated into the message itself are redacted | `logger-scrub.test.ts` → `SEC-M1 repair` |
| LOG-2f | Long opaque token shapes in messages scrubbed while preserving ordinary prose | `logger-scrub.test.ts` |
| LOG-1 | Tenant-safe identifiers (installationId) allowed in logs | `logger-scrub.test.ts` |

### 4.2 Export hygiene

| ID | Rule | Test |
|----|------|------|
| SEC-L1 | Spreadsheet-formula injection neutralized in CSV (`=`, `+`, `-`, `@`, `\t` prefixed cells) | `export-hygiene.test.ts` |
| SEC-L2 | Email addresses: local-part only, domain dropped in wire parse | `live-shape-parity.test.ts` → `parses raw live payloads` |

---

## 5. Partial Scan and Error Semantics

### 5.1 Degraded streams must not mint SAFE_NOW money

| ID | Rule | Test |
|----|------|------|
| FP-19 | Pagination truncation: PARTIAL status, coverage scoped to drained pages | `false-positive-matrix.test.ts` → `FP-19` |
| FP-20 | 403 on one product mid-scan: PARTIAL + permission surfacing, no fabricated zeros | `false-positive-matrix.test.ts` → `FP-20` |
| FP-21 | 429 then successful retry: COMPLETE with recovery recorded | `false-positive-matrix.test.ts` → `FP-21` |
| FP-22 | Repeated 5xx: PARTIAL/FAILED with clean degraded UX data | `false-positive-matrix.test.ts` → `FP-22` |
| FP-23 | Malformed activity payload preserved as UNKNOWN (no silent inactive-default) | `false-positive-matrix.test.ts` → `FP-23` |
| HIGH-3 | Partial Jira sweep degrades EVERY jira seat's decision-grade coverage; stale-prefix users drop to UNKNOWN, their money leaves totals | `partial-drain.test.ts` |
| HIGH-3b | Full sweep with same users books legitimate classifications (control) | `partial-drain.test.ts` |

### 5.2 Pagination honesty

| ID | Rule | Test |
|----|------|------|
| HIGH-5a | Unknown pagination continuation (no isLast, no total, no token) → DEGRADED stream + PARTIAL scan | `truncation.test.ts` |
| HIGH-5b | Short page against requested size → OK + COMPLETE (evidenced termination) | `truncation.test.ts` |
| HIGH-5c | Empty page after bare full page without position echo → honest PARTIAL | `truncation.test.ts` |
| HIGH-5d | Position-echoing responder probed to completion → everything acquired | `truncation.test.ts` |

### 5.3 Stream state and report status mapping

| Stream State | Report Status | Rule |
|-------------|---------------|------|
| All OK | COMPLETE | Deterministic |
| Any FAILED/DEGRADED | PARTIAL | No fabricated zeros |
| All FAILED | PARTIAL | Never COMPLETE |

---

## 6. Fixture / Live Separation

### 6.1 Data mode selection (fail-closed)

| ID | Rule | Test |
|----|------|------|
| FIX-1 | Default is LIVE; fixture requires exact `ATLAS_DATA_MODE=fixture` opt-in | `provenance-ui.test.ts` → `FIX-1` |
| FIX-1b | Whitespace-wrapped, "demo", or other values rejected | `provenance-ui.test.ts` |

### 6.2 Provenance stamping

| ID | Rule | Test |
|----|------|------|
| FIX-2 | Every report, recommendation, and stream carries dataMode stamp | `provenance-ui.test.ts` → `FIX-2/FIX-3` |
| FIX-3 | Dashboard shows unmissable "DEMO DATA / NOT A LIVE SCAN" banner for fixture | `provenance-ui.test.ts` |
| SEC-M2 | Missing/corrupted dataMode stamp renders non-live banner (fail-closed) | `provenance-ui.test.ts` → `SEC-M2 repair` |

### 6.3 Export stamping

| ID | Rule | Test |
|----|------|------|
| FIX-4a | CSV exports carry watermark, assumptions, window coverage, model version | `provenance-ui.test.ts` → `FIX-4` |
| FIX-4b | Markdown brief carries stamped warning header | `provenance-ui.test.ts` |
| FIX-4c | Header lines enumerate partial streams when present | `provenance-ui.test.ts` |

### 6.4 Live-shape parity

| ID | Rule | Test |
|----|------|------|
| LIVE-SHAPE-1 | Raw HTTP-shaped JSON (production payload shapes) through ForgeAtlassianGateway drives REAL ScanService → deriveReport | `live-shape-parity.test.ts` |
| LIVE-SHAPE-2 | Confluence contribution 5d ago in production payload shape forces KEEP, never SAFE_NOW | `live-shape-parity.test.ts` → `BLOCKER 1 repair` |
| LIVE-SHAPE-3 | Adapter-level equivalence: raw row parses to same Wire DTO as fixture path | `live-shape-parity.test.ts` → `parses raw live payloads` |

### 6.5 Adapter rule (no separate demo scanner)

| ID | Rule | Test |
|----|------|------|
| ADAPT-1 | Only two gateway implementations: ForgeAtlassianGateway (real) and FixtureAtlassianGateway (deterministic) | Code review + `parity-equivalence.test.ts` |
| ADAPT-2 | Everything downstream of gateway boundary is identical for both | `parity-equivalence.test.ts` → `AC10` |

### 6.6 Money integrity

| ID | Rule | Test |
|----|------|------|
| M-INT-1 | Safe-now pool equals sum of per-card exact deltas | `false-positive-matrix.test.ts` → `default-scan money integrity` |
| M-INT-2 | Quote-required items counted and excluded from nothing silently | `false-positive-matrix.test.ts` |
| M-INT-3 | Every money figure traces to model version + effective date + positions | `false-positive-matrix.test.ts` |
| M-INT-4 | Pool policy unification: CSV/markdown/dashboard share ONE pool policy | `export-hygiene.test.ts` → `MEDIUM 6 repair` |

---

## 7. Pricing and Financial Integrity

| ID | Rule | Test |
|----|------|------|
| FP-24 | Progressive-band pricing: golden case (450 Jira Standard monthly = $3,175.00/mo) | `pricing.golden.test.ts` |
| FP-25 | Minimum-seat floors: no savings while removal stays at/below floor | `pricing.golden.test.ts` |
| AC4-B | 12+ boundary crossing cases including annual tier steps | `pricing.golden.test.ts` |
| AC4-NB | Never extrapolates beyond sourced range; flags unbounded | `pricing.golden.test.ts` |
| AC12 | Dataset staleness detection and source metadata | `pricing.golden.test.ts` |

---

## 8. Memory and Resource Budgets

| ID | Rule | Test |
|----|------|------|
| ADV-5 | 60k users × 120k issue hits derives under 512 MB Forge function budget | `memory-ceiling.test.ts` |
| ADV-5b | Completion time < 30s, well under 900s async budget | `memory-ceiling.test.ts` |

---

## 9. Export and Injection Defenses

| ID | Rule | Test |
|----|------|------|
| SEC-L1 | `=HYPERLINK(...)`, `+SUM(...)`, `-2+2`, `@cmd`, `\tTAB` display names neutralized in CSV cells | `export-hygiene.test.ts` |
| AC9 | CSV header includes partial_stream entries for failed streams | `provenance-ui.test.ts` |
| AC13 | Markdown brief savings summary equals report.totals exactly | `export-hygiene.test.ts` |

---

## 10. Release Gate Requirements

Every release must pass these **deterministic** gates. No gate may be weakened or skipped.

| Gate | Requirement | Status |
|------|-------------|--------|
| GATE-1 | False-positive matrix: all FP-S1..S4 + FP-01..FP-28 pass | PASS (run 33067877466) |
| GATE-2 | Unit/integration suite: 127/127 tests, 15/15 files | PASS |
| GATE-3 | Tenant isolation + key injection (TEN-1..5, ADV-1..2) | PASS |
| GATE-4 | Export hygiene + formula injection (SEC-L1) | PASS |
| GATE-5 | Partial/error semantics + transport discipline (ERR-1..7) | PASS |
| GATE-6 | Provenance, fixture visibility, export honesty (FIX-1..4) | PASS |
| GATE-7 | Pricing golden vectors + band boundaries + exact cents | PASS |
| GATE-8 | Large-tenant memory ceiling (60k × 120k under 512 MB) | PASS |
| GATE-9 | Scan concurrency lease (SEC-H2) | PASS |
| GATE-10 | Live-shape parity through production adapters (BLOCKER 1 repair) | PASS |
| GATE-11 | High/critical dependency advisory gate | PASS |
| GATE-12 | Backend TypeScript check | PASS |
| GATE-13 | UI Kit/frontend TypeScript check | PASS |
| GATE-14 | Build gate | PASS |
| GATE-15 | Isolated Forge parity (Node 24, 512 MB, --network=none) | PASS |

---

## 11. Honest Residuals (known UNKNOWNs)

These are documented, non-cosmetic gaps that must be settled with live evidence before MARKETPLACE_READY.

| ID | Residual | Required Evidence |
|----|----------|-------------------|
| RES-1 | Authenticated Forge registration/lint/deploy/install not yet live | Real Forge CLI run with repo secrets |
| RES-2 | Actual acceptance of required Jira/Confluence scopes under installed-app identity | Live install + scope verification |
| RES-3 | Live pagination/continuation shapes | Real API responses |
| RES-4 | Tenant-context consistency between resolver and scheduled-trigger contexts | Live trigger observation |
| RES-5 | Resolver accessibility/authorization for non-admin users | Live non-admin invocation |
| RES-6 | Forge KVS behavior under concurrent lease/checkpoint access | Live concurrency test |
| RES-7 | End-to-end real tenant scan with manual spot checks | Manual verification |
| RES-8 | Branch protection certification | GitHub settings confirmation |
| RES-9 | KVS scan lease race-proof status | Live Forge KVS semantics |

---

## 12. Test Execution Protocol

### 12.1 Gate ordering

1. `npm ci` (clean install)
2. `npx vitest run` (full suite: GATE-1 through GATE-10)
3. `npx tsc --noEmit` (backend typecheck: GATE-12)
4. `npx tsc --noEmit` (UI Kit/frontend typecheck: GATE-13)
5. Static/security/Marketplace checks (GATE-4, GATE-5, GATE-6)
6. Dependency audit: high/critical gate (GATE-11)
7. Build gate (GATE-14)
8. Isolated Forge parity: Node 24, 512 MB, --network=none (GATE-15)

### 12.2 Failure policy

- **Any GATE failure → no promotion.** The candidate is not merged to `main`.
- **BLK-1 (false-positive SAFE_NOW where KEEP/REVIEW/UNKNOWN required) → immediate suite failure.**
- **TEN-* failure → immediate suite failure.**
- **LOG-* failure → immediate suite failure.**
- **LIVE-SHAPE-* failure → immediate suite failure.**

### 12.3 Fixture data requirements

Every test variant must be drawn from the mandatory fixture set defined in `docs/FORGE_PARITY_MODE.md` §Required test fixtures:

- active user
- 30/60/90/180-day inactive users
- never-observed activity
- admin
- probable service/technical account
- product access through one group
- redundant access through multiple groups
- Jira-only vs Confluence-only evidence
- JSM agent-like case
- JPD creator-like case
- missing/unknown activity
- insufficient permissions
- pagination
- rate limit then retry/recovery
- partial scan failure
- tier/pricing boundary cases

---

## 13. Anti-Regression Checklist

Before any release, verify:

- [ ] No SAFE_NOW card exists without CORROBORATION_RULE=PASS
- [ ] No SAFE_NOW card exists with a protected-class FAIL
- [ ] No recommendation carries money without WHAT/WHY/MONEY/RISK/EVIDENCE
- [ ] Hero savings = exact-sum-rounded-down-once
- [ ] Per-item floors never exceed hero
- [ ] Deactivated accounts carry zero money
- [ ] Unknown accounts carry no money
- [ ] PARTIAL scans book zero safe-now savings from undrained streams
- [ ] CSV exports carry dataMode watermark
- [ ] Markdown brief carries stamped warning header
- [ ] Dashboard shows non-live banner for fixture data
- [ ] Missing dataMode stamp shows non-live banner (fail-closed)
- [ ] Formula-shaped display names neutralized in CSV
- [ ] Email domains stripped in wire parse
- [ ] Credentials never appear in log output
- [ ] Tenant storage keys are installationId-namespaced
- [ ] Cross-tenant key access impossible via storage API
- [ ] Scan lease blocks concurrent advancement
- [ ] Expired lease takeover succeeds
- [ ] Terminal scan states release lease
- [ ] 429 Retry-After honored as floor
- [ ] 401/403 never retried
- [ ] 5xx exhausts retries, no infinite loop
- [ ] Pagination truncation → PARTIAL, not COMPLETE
- [ ] Malformed payloads → UNKNOWN, not SAFE_NOW
- [ ] Memory ceiling: 60k × 120k under 512 MB
- [ ] Transport equivalence: fixture and replay produce identical reports
- [ ] Org evidence merge: MAX recency, not positional first
- [ ] Conflicting recent signal: <90d org observation → KEEP
- [ ] Pricing: progressive bands, minimum floors, no extrapolation beyond sourced range
- [ ] No demo scanner; only ForgeAtlassianGateway + FixtureAtlassianGateway

---

## 14. Scope Restrictions

As `security_test_architect`, I must not:

- Request speculative permissions or accept missing activity as safe-removal evidence
- Write product implementation code
- Create branches, workflows, or handoff mechanisms
- Weaken tests or gates
- Invent live success or authenticated Forge evidence
- Add external LLM/SaaS dependencies
- Modify `ATLAS_MASTER_PROMPT.md`, `AGENTS.md`, `PRODUCT_CONTRACT.md`, `docs/FORGE_PARITY_MODE.md`, `docs/agents/AGENT_CARDS.md`, `.opencode/agents/`, `.github/workflows/`, or `.github/scripts/`
