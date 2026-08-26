# Atlas — API Feasibility Addendum (Builder deviations, 2026-08-26)

Status: BUILDER-RECORDED DEVIATIONS against `.factory-inputs/API_FEASIBILITY.md`.
These are narrow, conservative resolutions of conflicts between the three
architecture handoffs. Each entry names the rule that forced it. Red teams and
the Release Integrator should attack/review exactly these points.

## A1. Issue-derived activity evidence: endpoint + scope added (VERIFY-LIVE)

- **Need:** PRODUCT_V1 F2/L1 makes issue-derived activity evidence mandatory;
  without it no inactivity claim is possible at all. Feasibility §4 explicitly
  sanctions the signal ("Issue authorship/assignment/comment/worklog recency —
  Jira search") but §3's endpoint table omits a concrete search endpoint.
- **Resolution:** Atlas calls `POST /rest/api/3/search/jql` (enhanced JQL
  search) with `fields: ["creator","assignee","reporter","created","updated"]`
  and cursor pagination (`nextPageToken`).
- **Scope declared:** classic `read:jira-work` per the current endpoint
  documentation. This is the single scope NOT present in feasibility §8's
  manifest template.
- **VERIFY-LIVE obligations:** confirm exact current scope string(s) accepted
  by this endpoint under an installed app identity, confirm `asApp()` behavior
  (L1 checklist), snapshot response shape. Comment/worklog author signals were
  deliberately NOT implemented in V1 (payload weight); their absence only ever
  weakens evidence toward REVIEW/UNKNOWN, never toward SAFE NOW.

## A2. Audit-record stream dropped (least privilege)

Feasibility lists `read:audit-log:jira` "only if audit evidence stream
implemented". V1 does not ship the audit stream: account-lifecycle events are
a weak signal for renewal savings and the scope fails the SEC-2 zero-use test.
Manifest therefore declares 9 read scopes, none admin/write.

## A3. Organization Admin enrichment ships disabled

Feasibility grades org-API enrichment GO WITH CONSTRAINTS (optional);
security plan §1.5 keeps the org API key TEST-ONLY and SEC-2c forbids it in
the default request path.

- Gateway interface exposes `orgConfigured()/listOrgUsers()` so downstream
  code and fixtures exercise the stronger-evidence class today.
- Production composition root constructs the Forge gateway with
  `orgEnrichment.enabled=false`; `api.atlassian.com` is intentionally NOT
  declared as a manifest remote (an undeclared remote cannot be reached; a
  declared-but-unexercised one would violate GATE-2/BLK-5).
- Enabling later requires: security review of secret storage, adding exactly
  one remote declaration, and flipping the flag — no redesign.

## A4. Ladder rung shipped: L2/L3 with degraded-confidence labels

PRODUCT_V1 §2.3 defines L1 minimum through L4. Feasibility verdicts:

| Rung | Verdict basis | Shipped state |
|---|---|---|
| L1 Jira | GO | Fully shipped (seats via applicationrole, activity via search, money via sourced bands) |
| L2 Confluence | partial GO / seat enumeration DEGRADED | Shipped as candidate-access analysis: group-derived candidates, contribution sweeps, seat status explicitly UNKNOWN; reclaim/money restricted accordingly |
| L3 JSM | derived GO | Agent seats resolved from `jira-servicedesk` application role groups |
| L4 JPD | UNKNOWN beyond plan status | Plan status shown; NO JPD seat enumeration or JPD savings claims |

Stopping at L1 would have been over-conservative given feasibility explicitly
sanctions group-derived Confluence candidates; shipping L4 claims would have
been fabrication. Deviation recorded here rather than silently widened.

## A5. Pricing datasets: only golden-anchored table marked SOURCED

PRODUCT_V1 §5 wants versioned tables per product×plan. BLK-7 forbids invented
precision. Resolution: the shipped snapshot contains ONE SOURCED dataset —
Jira Standard monthly progressive bands (1–100 @$8.60, 101–250 @$7.30,
251–500 @$6.10, verified by the published 450-seat worked example) plus a
documented minimum-billable floor of 10 seats. Every other product/plan is an
explicit `PRICING_UNKNOWN` dataset producing quote-required output. The engine
fully supports annual fixed-tier tables (tested) for when sourced data lands.

## A6. SAFE_NOW corroboration implementation

Feasibility §4 binds SAFE_NOW to "org-API last-active OR ≥2 independent
product signals of long inactivity plus no protected-class markers".
Implemented literally:

- Org `last_active` ≥ threshold with full window coverage ⇒ eligible.
- Two independent drained surfaces — positively-stale observations or
  fully-drained negative sweeps — ≥90 days ⇒ eligible.
- Everything else caps at REVIEW; missing/malformed data forces UNKNOWN
  (BLK-1); protected classes structurally barred.

## Provenance

Written by `implementation_builder` on 2026-08-26 from the mounted handoffs.
No feasibility verdict was weakened: every UNKNOWN/DEGRADED/BLOCKED row is
preserved in code as UNKNOWN/DEGRADED behavior with tests enforcing it.

---

# Release Integrator additions (2026-08-26 repair pass)

## A7. `read:avatar:jira` endpoint-level justification (SEC-H1 resolution)

- **Status:** KEPT, with recorded basis and a live drop-condition.
- **Basis:** `.factory-inputs/API_FEASIBILITY.md` (endpoint table) lists
  `read:avatar:jira` among the current requirements of BOTH endpoints Atlas
  actually calls for seat inventory: `/rest/api/3/users` and
  `/rest/api/3/group/member`. Atlas consumes none of the avatar subfields;
  they are tolerated-null in the shared adapters (`parseWireUserItem`).
- **Enforcement:** GATE-2 is now usage-based
  (`scripts/static-gates.mjs`, hardened per SECURITY.md SEC-H1): every
  manifest scope must map to a `SCOPE_BUDGET` entry whose named call exists
  as a real call site in a transport implementation. A declared scope with no
  exercising call fails the build. `read:avatar:jira` is budgeted against
  `listJiraUsers`/`listGroupMembers` with this entry as its written
  justification.
- **VERIFY-LIVE drop-condition:** on first authenticated install, confirm
  whether both endpoints serve without `read:avatar:jira`. If they do,
  REMOVE the scope from manifest, allowlist, and budget in the same pass
  (least privilege wins; zero-consumption scopes are dropped per SEC-2(2)).
  Until then treat unexercised-subfield drift as reachable and re-check at
  each audit cycle, exactly as the security audit directed.

## A8. GATE-2 hardening record (SEC-H1)

The gate previously proved only set equality between manifest and a
builder-owned allowlist; the security audit empirically shipped a
declared-but-zero-use scope through it green. It now also extracts
`SCOPE_BUDGET[scope].calls` from `src/gateway/types.ts` and requires at least
one call site to exist in `src/gateway/forge/forgeGateway.ts` or
`src/gateway/fixture/fixtureGateway.ts`. Verified: the audit's exact probe
(add `read:audit-log:jira` to manifest + allowlist + budget) now FAILS with
`GATE-2/SEC-H1: ... none exist in any transport implementation`.

## A9. Production transport defect found during repair (live-shape parity)

Feeding RAW HTTP-shaped payloads through `ForgeAtlassianGateway` (the test
class FUNCTIONAL.md demanded) exposed an additional pre-repair defect no
fixture/replay test could see: `listConfluenceGroupMembers` passed the
substituted path as the telemetry `endpoint` argument and requested the
LITERAL `{groupId}` template path in production. Fixed; regression coverage
in `test/live-shape-parity.test.ts`. Recorded here because it changes what
first live verification will exercise.
