# Atlas V1 — Canonical Narrow Money-First Product Specification

Status: HUMAN-OWNED, BINDING, FROZEN.
Updated: 2026-08-27

## 1. One sentence

Install Atlas → scan the Atlassian environment → show credible **ESTIMATED ANNUAL SAVINGS** immediately → explain each opportunity → enable safe remediation only when technically justified.

## 2. Scope freeze

### 2.1 What V1 does

V1 produces a financially credible report of potentially recoverable Atlassian license spend from real accessible data. Nothing else.

### 2.2 What V1 does not do

No generic user management, Jira analytics, AI assistant, consultancy product, enterprise platform, external SaaS spend platform, AWS/Azure FinOps, ERP, Slack/Gmail/ServiceNow integration, giant RBAC, mobile, Data Center, AI copilot, global benchmark system, or executive cockpit. No chatbots, LLM summaries, AI badges, or opaque scoring.

### 2.3 Ladder of evidence depth (frozen)

| Rung | Product | Verdict | Shipped state |
|------|---------|---------|---------------|
| L1 | Jira | GO | Fully shipped: seats via application-role, activity via search JQL, money via sourced bands |
| L2 | Confluence | partial GO / seat enumeration DEGRADED | Candidate-access analysis: group-derived candidates, contribution sweeps, seat status UNKNOWN; reclaim/money restricted |
| L3 | JSM | derived GO | Agent seats resolved from `jira-servicedesk` application-role groups |
| L4 | JPD | UNKNOWN beyond plan status | Plan status shown; NO seat enumeration or savings claims |

Claim support only where current APIs provide defensible evidence. Every UNKNOWN/DEGRADED row is preserved in code with tests enforcing it.

## 3. Money-first UX

The principal UI metric is **ESTIMATED ANNUAL SAVINGS**. Money leads; user counts appear nowhere on the first screen.

Target first experience:
1. Install (authorize nine read scopes).
2. Open admin page (no extra action beyond navigation).
3. Automatic scan (default-on, no configuration screen).
4. Dollars appear.
5. Optional: set renewal date, inspect recommendations, export.

Target time-to-value: under five minutes for small sites. Admin interaction count to first dollars: **authorize → open page**. All further steps are optional.

### 3.1 Dashboard structure (frozen)

```
ESTIMATED ANNUAL SAVINGS
$X / year
Safe now: $A · Review pool: $B · quote-required items: N
Scan COMPLETE · jira, confluence, jsm · window 180d · <ts> · dataMode=LIVE|FIXTURE
```

Below the hero:
- Partial scan warning (when applicable).
- Pricing staleness warning (when applicable).
- Renewal date strip (prompt or countdown).
- Per-product breakdown table (Product, Seats, Safe Now $/yr, Review Pool $/yr, Band/tier position, Boundary).
- Recommendations (SAFE NOW and REVIEW visible; KEEP and UNKNOWN collapsed with counts).
- Export buttons: Markdown renewal brief, CSV.
- Rescan button.

### 3.2 Recommendation card (frozen)

Every recommendation card answers WHAT, WHY, MONEY, RISK, EVIDENCE:
- **WHAT**: one-line description of the action (e.g. "Reclaim 1 licensed seat for X in jira").
- **WHY**: rule ID, threshold summary, detail narrative.
- **MONEY**: model version, effective date, before/after position, band/tier crossings, bounded status, realization timing.
- **RISK**: class (SAFE NOW / REVIEW / KEEP / UNKNOWN) plus every dependency check result.
- **EVIDENCE**: every observed signal with kind, source, timestamp, and detail.

Cards are collapsed by default. Expanding shows full traceability.

## 4. Risk classification engine

### 4.1 Canonical risk classes

- **SAFE NOW**: strong evidence, low observed dependency risk. Ready for action.
- **REVIEW**: plausible savings, human review required.
- **KEEP**: evidence of real need.
- **UNKNOWN**: insufficient evidence. Missing evidence is UNKNOWN, never SAFE.

### 4.2 Hard rules

- Inactivity is a signal, not proof.
- Inactivity ≥ 90 days is at best REVIEW (never automatically SAFE).
- Missing/unverifiable activity forces UNKNOWN. Absence of data never lowers risk or produces SAFE classifications.
- False-positive removal recommendations are the worst product failure.
- Protected classes are structurally excluded from SAFE NOW.

### 4.3 Protected classes

Accounts matching any of these are never SAFE NOW:
- Admin-like group membership (e.g. `jira-administrators`, `site-admins`, `confluence-administrators`).
- Service/technical account heuristics (name/email markers).
- Explicit admin-managed exception list.
- Deactivated accounts (active=false) — classified KEEP because no removable billable seat exists.

### 4.4 Corroboration rule

SAFE NOW requires **≥2 independent product signals** of long inactivity:
- Two independent drained surfaces (positively-stale observations or fully-drained negative sweeps) ≥ 90 days, OR
- Organization-level last-active ≥ threshold with full window coverage.

Single-surface evidence caps at REVIEW. Two or more corroborating independent surfaces unlock SAFE NOW.

### 4.5 Observation window

Default: 180 days. Account age must exceed the observation window for absence to be meaningful. Accounts younger than the window produce UNKNOWN for never-observed cases.

### 4.6 Inputs (resolved upstream)

Per account:
- Account ID, display name, email hint, active flag, account creation date, account type (human/service_heuristic/unknown).
- Product seats held (product ID, group membership, seat status BILLABLE/FREE_TIER_ROLE/UNKNOWN).
- Product evidence (signals, coverage, data-unavailable reason).
- Protection profile (admin-like, service heuristic, exception, deactivated, account age).
- Renewal config (next renewal date, exception account IDs).

## 5. Financial engine

### 5.1 Core invariants

- Integer cents everywhere; no floating point money.
- Savings = cost(before) - cost(after) integrated on the pricing curve.
- Naive `seats × flat price` is forbidden.
- Seats below the documented minimum bill at the minimum.
- Seat counts above `knownUpToSeats` → bounded=false; such estimates never enter aggregate totals.
- Presentation rounding happens exactly once, rounding savings DOWN. Aggregates are exact sums rounded once, never sum-of-rounded.
- Per-item pricing conservatively understates simultaneous removals that cross pricing-band boundaries; it must not be represented as exact billing truth.

### 5.2 Pricing datasets

Only sourced, verified data is marked SOURCED. All other product/plan combinations are explicitly `PRICING_UNKNOWN` producing quote-required output.

**Current shipped snapshot:**

| Product | Plan | Billing mode | Status | Sourced range |
|---------|------|-------------|--------|---------------|
| Jira | Standard | Monthly progressive bands | SOURCED | 1–500 seats |
| Jira | Premium/Enterprise | — | PRICING_UNKNOWN | — |
| Confluence | All | — | PRICING_UNKNOWN | — |
| JSM | All | — | PRICING_UNKNOWN | — |
| JPD | All | — | PRICING_UNKNOWN | — |

**Jira Standard monthly bands (sourced 2026-08-26):**
- 1–100 seats: $8.60/seat/month
- 101–250 seats: $7.30/seat/month
- 251–500 seats: $6.10/seat/month
- Minimum billable seats: 10
- Source: atlassian.com licensing/cloud progressive-band example
- Golden anchor: 450 seats = $8.60×100 + $7.30×150 + $6.10×200 = $3,175.00/month

Each dataset carries: model version, effective date, source URL, notes, band/tier definitions, minimum billable seats, and `knownUpToSeats` boundary.

### 5.3 Staleness

Datasets older than 180 days trigger a visible staleness warning in the UI. Staleness does not disable the estimate but makes assumptions visible.

### 5.4 Scenario math

The engine computes deltas for both billing modes:
- **Monthly progressive bands (MQB)**: peak-seat based. Reductions realize NEXT_BILLING_PERIOD.
- **Annual fixed tiers**: per-seat annual. Reductions realize NEXT_RENEWAL.

Band/tier boundary crossings are detected and surfaced explicitly.

### 5.5 Money honesty model

- Include only defensible (bounded, SOURCED) portions in aggregate totals.
- When ANY held product lacks verified pricing, the estimate is flagged bounded=false with explicit reason.
- Unbounded portions are counted as quote-required, not silently dropped.

### 5.6 Aggregate totals

- `safeNowAnnualCents`: exact cents from SAFE NOW recommendations with bounded money.
- `reviewPoolAnnualCents`: exact cents from REVIEW recommendations with bounded money.
- `quoteRequiredCount`: recommendations where money is null or unbounded.
- `keepCount` / `unknownCount`: population-level counts (not just emitted cards).
- `deactivatedExcludedCount`: accounts excluded because already deactivated.
- `protectedExcludedFromSafeNow`: accounts excluded from SAFE NOW due to protected-class hits.

## 6. Evidence model

### 6.1 Activity signals

| Signal kind | Product | Description |
|-------------|---------|-------------|
| ISSUE_AUTHORSHIP | Jira | User authored an issue |
| ISSUE_ASSIGNMENT | Jira | User was assigned an issue |
| CONFLUENCE_CONTRIBUTION | Confluence | User created/edited content |
| ORG_LAST_ACTIVE | (org-wide) | Organization-level last active date |
| NEGATIVE_SWEEP_JIRA | Jira | Full-window drain found zero contributions |
| NEGATIVE_SWEEP_CONFLUENCE | Confluence | Full-window drain found zero contributions |

Comment and worklog author signals are deliberately NOT implemented in V1 (payload weight); their absence only ever weakens evidence toward REVIEW/UNKNOWN.

### 6.2 Evidence per user × product

Each user-product evidence record contains:
- Account ID and product ID.
- List of activity signals.
- Window coverage (start, end, complete flag).
- Data-unavailable reason (when required input was missing/malformed).
- Any-positive-signal flag.

### 6.3 Coverage

- Streams that fully drain with permission-clean acquisition produce complete coverage.
- Partial/degraded streams produce incomplete coverage → staleness cannot be bounded honestly → UNKNOWN.
- No result from incomplete data may be labeled as a complete scan.

## 7. Pricing and honesty rules

- All financial values expose assumptions and uncertainty.
- Tier/band/minimum pricing is scenario-based, not naive seats × list price.
- Estimates only: no Atlassian API exposes customer billing.
- Every dataset is a labeled list-price snapshot with source URL and effective date.
- Real invoices depend on negotiated discounts, taxes, and plan changes.
- Currency: USD only in V1.

## 8. Scan architecture

### 8.1 Chunked execution

Scans are checkpointed and chunked:
- Bootstrap queues the scan record and runs the first chunk synchronously.
- Polling advances the checkpointed scan by one chunk per tick.
- Five-minute scheduled trigger resumes large scans.
- KVS stores cursors, derived acquisition rows, scan/report state, and renewal configuration.

### 8.2 Transport boundary

- `AtlassianGateway` interface owns all Atlassian API access.
- Two implementations: `ForgeAtlassianGateway` (production) and `FixtureAtlassianGateway` (deterministic test data).
- Everything downstream of that boundary is identical.
- Fixture mode is impossible to mistake for a real scan in UI, logs, or persisted state.
- No separate "demo scanner" exists.

### 8.3 Manifest scope budget

Nine read-only scopes, zero write scopes, zero admin scopes, no egress remotes:

| Scope | Justification |
|-------|---------------|
| read:license:jira | License and seat enumeration |
| read:application-role:jira | Application role group membership |
| read:user:jira | User account metadata |
| read:group:jira | Group membership for access paths |
| read:avatar:jira | Required by user/group list endpoints (VERIFY-LIVE drop candidate) |
| read:jira-work | Issue-derived activity evidence |
| read:content-details:confluence | Confluence content contribution evidence |
| read:user:confluence | Confluence user metadata |
| read:group:confluence | Confluence group membership |

Every declared scope maps to a real call site in a transport implementation. A declared scope with no exercising call fails the build.

### 8.4 Runtime

- Forge app targeting Node.js 24.x, 512 MB memory.
- `app.licensing.enabled: true`.
- Two Forge functions: resolver (admin page) + scheduled scan-chunk worker (timeoutSeconds: 900, interval: fiveMinute).
- Modern UI Kit Jira admin page with resource, render: native, and resolver wiring.
- Pre-registration sentinel ARI replaced by `forge register` during live gate.

## 9. Renewal framing

Structure the model around renewal from day one:
- Optional next-renewal date input (YYYY-MM-DD).
- Countdown display (T-minus days to renewal).
- Exposure-until-renewal note.
- Renewal-ready exports (Markdown brief, CSV).
- Realization timing: NEXT_BILLING_PERIOD (monthly) or NEXT_RENEWAL (annual).

## 10. Free → paid boundary

A free audit must reveal enough value to prove money exists:
- The hero dollar amount is always visible.
- SAFE NOW and REVIEW recommendations are always visible with full traceability.
- Export buttons are always available.
- Quote-required items are counted and surfaced.

Paid can later unlock: complete recommendations, remediation, monitoring, history, workflows, renewal planning, multi-site. Do not make free useless.

## 11. Tests

### 11.1 Required test coverage

- Active user, inactive user (30/60/90/180 days), never-active user.
- Multi-group access and redundant access.
- Admin, probable service/technical account.
- JSM agent-like case, JPD creator-like case (when supported).
- Missing/malformed data → UNKNOWN.
- Insufficient permissions → degradation, not failure.
- 401/403 and repeated 5xx degradation.
- 429/Retry-After recovery.
- Pagination truncation.
- Partial scan failure and drain safety.
- Pricing golden vectors, band boundaries, exact cents.
- Totals/card-cap accounting.
- Export hygiene and formula injection prevention.
- Tenant isolation and log secret scrubbing.
- Scan lease/concurrency (best effort).
- Fixture/live-shaped transport equivalence.
- 60k users × 120k activity hits under 512 MB Forge budget.
- False-positive removal classification (attack aggressively).

### 11.2 Test infrastructure

- Vitest as the test runner.
- TypeScript type checking for backend and frontend.
- Static gates and Marketplace readiness gates.
- Forge parity script: Node 24, 512 MB, `--network=none`.

## 12. Marketplace intent

Optimize product, copy, and UX for relevant Marketplace intent:
- Atlassian license optimizer
- Jira license cost optimizer
- Inactive Jira/Confluence users
- Reduce Atlassian cost
- Atlassian renewal
- JSM/JPD license optimization
- License reclamation

Do not keyword-stuff.

## 13. Competitors

Treat Recoup — License Cost Optimizer as a direct competitor, not proof of an empty niche. The strategic differentiation is renewal preparation and execution rather than merely reporting inactive seats. Do not copy competitors.

## 14. Security requirements

- Least privilege: nine read scopes only, zero write/admin.
- Minimal storage: compact cursors, derived rows, scan state, renewal config.
- Tenant isolation: storage keys namespaced from installation identity.
- No secrets in logs or repo: explicit PII/secret scrubbing tests.
- No external egress in V1.
- Organization-admin enrichment disabled in production unless explicitly reviewed and enabled.
- No external LLM/API dependency.

## 15. Definition of done

Not "code compiles." Not "tests pass." Not "dashboard looks nice."

Done means: **an actually installable Atlassian app that analyzes a real environment and shows a useful, explainable financial estimate compelling enough that someone could rationally pay for it.**

## 16. Current state (2026-08-27)

Status: **PARITY_READY_AWAITING_CREDENTIALS**

- 127/127 tests pass.
- All deterministic gates pass (typecheck, static, security, Marketplace, dependency audit, build, Forge parity).
- Authenticated Forge/live proof is missing.
- Eight moderate dependency advisories remain; no high/critical advisory fails the release gate.

### 16.1 Honest residuals

- Not Marketplace-ready: authenticated Forge/live Jira proof is missing.
- Per-item pricing can conservatively understate simultaneous removals that cross pricing-band boundaries.
- Best-effort KVS scan lease cannot be called race-proof until live Forge concurrency semantics are observed.
- A stale historical `factory/continuation` branch exists at GitHub-ref level; current automation neither reads nor writes it.

### 16.2 Next action

Retire UNKNOWNs with live evidence when credentials become available:
1. Authenticated Forge registration, lint, development deploy, and Jira install.
2. Actual acceptance of required scopes under installed-app identity.
3. Live pagination/continuation shapes.
4. Tenant-context consistency between resolver and scheduled-trigger contexts.
5. Resolver accessibility/authorization for non-admin users.
6. Forge KVS behavior under concurrent lease/checkpoint access.
7. End-to-end real tenant scan with manual spot checks.
8. Final Marketplace/security/privacy packaging.
