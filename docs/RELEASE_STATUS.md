# RELEASE STATUS — release_integrator, cycle 2026-08-26

Status: **RELEASE CANDIDATE — parity gates PASS; awaiting live Atlassian
credentials.** `state/factory_direction.json` is set accordingly.

- Input snapshot: git `40ffe57` ("Atlas V1 build 32922567715").
- Repair inputs: `.factory-inputs/audits/FUNCTIONAL.md` (2 BLOCKER, 3 HIGH,
  4 MEDIUM, 3 LOW) and `.factory-inputs/audits/SECURITY.md` (2 HIGH, 5 MEDIUM,
  4 LOW, no BLOCKER). Both audits were produced independently against the
  exact builder snapshot; this file records the single repair/integration
  pass performed after both.
- Scope discipline: no product scope was widened, no audit finding erased,
  no test weakened, no live success invented. Existing 97 tests all still
  pass unmodified in their assertions; every repair adds regression coverage
  (127 tests total across 15 files now).

---

## 1. Verification evidence (re-executed by Release Integrator)

| Gate | Result |
|---|---|
| Baseline reproduction before repairs | `npm run lint` green · `npm run typecheck` clean · `npm test` 97/97 · fixture CLI hero $309 SAFE / $412 REVIEW ($722 total) — matches both audits' recorded baseline |
| After repairs: static gates | `npm run lint` all PASS incl. new `GATE-2/SEC-H1: every manifest scope is exercised by a real gateway call site` |
| After repairs: typecheck | `tsc --noEmit` clean (strict) |
| After repairs: unit/integration | `npm test` → **127 passed / 15 files** (97 pre-existing + 30 new regression tests) |
| Fixture CLI | default variant reproduces $309/$412 exactly; org_enriched variant $412/$309 |
| Forge parity container | `bash .github/scripts/forge-parity-check.sh` → Node 24 / 512 MB / 512 MB tmpfs / `--network=none` → **FORGE_PARITY_GATE=PASS** |
| SEC-H1 probe re-run | On a throwaway copy: adding a declared-but-zero-use scope in all three documentation locations now **FAILS** (`GATE-2/SEC-H1: ... none exist in any transport implementation`) — previously shipped green |

---

## 2. Functional audit findings — disposition

### BLOCKER 1 — fabricated "measured absence" from live-shaped Confluence evidence → FIXED
Root cause chain broken at every link:
1. `searchConfluenceContributions` no longer builds Wire hits inline with
   `lastModified: null`. Parsing happens ONLY through shared adapters
   (`parseWireContributionItem`, which preserves `version.when`; identity
   attribution via `attributedContribution`). The CQL is window-filtered by
   construction, so any returned hit IS within-window activity and its
   timestamp survives.
2. `buildContributionMap` additionally treats a real content hit with an
   unusable temporal field as UNVERIFIABLE (entry.complete=false), never as
   absence; zero-hit sentinels (contentId=null) remain the only absence proof.
3. Regression: `test/live-shape-parity.test.ts` feeds raw HTTP-shaped JSON
   through `ForgeAtlassianGateway`'s injected transport and drives the REAL
   ScanService pipeline: Carla (Jira hit 100d + Confluence contribution 5d,
   production payload shape) classifies KEEP/RULE_RECENT_ACTIVITY with zero
   "found zero observations" claims; Finn remains a legitimate
   measured-absence SAFE_NOW; scan COMPLETE.

### BLOCKER 2 — org-wide last-active shadows newer product-specific last-active → FIXED
`mergedOrgLastActiveForProduct()` merges org-wide and per-product
`last_active` by MAX recency; derive no longer takes positional `[0]`.
Regression: `test/org-evidence.test.ts` proves the merge helper, the
end-to-end case (org-wide 200d vs product-specific 2d ⇒ KEEP, not SAFE_NOW),
the capability-preservation control (consistent staleness still corroborates
to SAFE_NOW), and classifier precedence.

### HIGH 3 — PARTIAL scans mint SAFE_NOW savings from half-drained sweeps → FIXED
The `!aHasPositive(...)` escape is removed: an undrained Jira sweep forces
`dataUnavailableReason` on EVERY jira seat (UNKNOWN via RULE_DATA_UNAVAILABLE).
Users with genuinely recent prefix activity still KEEP via the
conflicting-recent screen, which runs before degradation. Regression:
`test/partial-drain.test.ts` (page1+HTTP500 ⇒ Paula UNKNOWN, safeNow totals 0;
Rico KEEP; drained control books legitimate classifications).

### HIGH 4 — totals contradicted card-cap invariant → FIXED
`computeTotals` accepts authoritative population counts; derive passes its
full-population KEEP/UNKNOWN counters. Emission cap unchanged for cards.
Regression: `test/totals-population.test.ts` (600 KEEP + 5 UNKNOWN + 3 SAFE ⇒
keepCount=600, unknownCount=5 regardless of sort order).

### HIGH 5 — responders omitting pagination silently truncate as COMPLETE → FIXED
New explicit drain-verdict model shared by every paged step
(`drainVerdict`/`applyPageOutcome`):
- explicit terminal flag / empty page / short-page-vs-requested ⇒ evidenced drain;
- full page with NO continuation fields and no position echo ⇒ stream DEGRADED
  ("pagination continuation unverifiable"), status PARTIAL;
- position-echoing responders are probed forward to completion; an
  offset-ignoring responder hits the first-item fingerprint guard (bounded,
  honest stop);
- `metaFrom` surfaces unknown continuation as `isLast: null` instead of
  defaulting TRUE (token-flavored endpoints keep documented
  absence-of-token-as-end semantics, recorded in addendum A1).
Regression: `test/truncation.test.ts` (4 cases). Also fixed en passant:
`json.size` is page-size in wiki responses and is no longer misread as total.

### MEDIUM 6 — CSV TOTALS disagreed with dashboard/markdown pools → FIXED
Exports render `report.totals` — the same single pool policy as hero and
markdown (documented: pools include the sourced portion of partially-bounded
cards; such rows still show QUOTE_REQUIRED per-row). Regression:
`test/export-hygiene.test.ts`.

### MEDIUM 7 — reclaimable products exceeded measured surfaces → FIXED (labeling)
`ClassificationResult.corroboratedProducts` carries the products where
inactivity/activity was actually measured; `Recommendation.productsMeasured`
plus WHAT-line annotation distinguish them from ride-along seats; markdown
renders `(measured: …)`. CSV gains a `products_measured` column.

### MEDIUM 8 — one-seat pricing understates multi-user batch savings across bands → NOT CHANGED (documented)
Direction-safe systematic understatement (constitution-safe), already
disclosed in pricing assumptions and handoff §4.5. Improving it requires
batch-scenario pricing design, not a repair; deferred to post-live iteration.
Edges verified correct by the functional audit itself (crossings, floors).

### MEDIUM 9 — no concurrency guard on chunk execution → FIXED (see SEC-H2 below)

### LOW 10 — zero-seat baseline renders "10 seats (billed at minimum)" → NOT CHANGED (cosmetic)
Delta stays $0; label-only nit inside minimum-floor no-op scenarios. Deferred
to avoid churn in finance display math during the repair pass.

### LOW 11 — "shared adapters" parity claim false for most production endpoints → FIXED
All paged production calls (`listJiraUsers`, `listGroups`, `listGroupMembers`,
Confluence groups/members, `searchIssueActivity`,
`searchConfluenceContributions`) parse through per-item shared adapters
(`parseWireUserItem`, `parseWireGroupItem`, `parseWireConfluenceMemberItem`,
`parseWireIssueActivityItem`, `parseWireContributionItem`). The fixture
gateway likewise synthesizes RAW payload shapes and routes through the SAME
adapters (also resolves SECURITY SEC-M3's fixture-side divergence, including
symmetric `windowStartIso` honoring in fixture contributions). Inline email
hint divergence eliminated (see SEC-L2).

### LOW 12 — dead `listUserGroups` capability + budget entry → FIXED (removed)
Capability removed from interface and both transports; endpoint constant and
budget references cleaned. Redundant-access detection remains out of V1 scope
as the handoff intended.

---

## 3. Security audit findings — disposition

### SEC-H1 — GATE-2 self-referential set equality → FIXED
Gate now derives each scope's exercising call names from
`SCOPE_BUDGET[scope].calls` in `src/gateway/types.ts` and greps transport
sources for real call sites; missing exercise fails the build; budget scopes
absent from the manifest also fail. `read:avatar:jira` kept WITH written
endpoint-level justification + VERIFY-LIVE drop-condition (addendum A7).
Probe re-run verified failing (§1 table). See addendum A8.

### SEC-H2 / F-MEDIUM 9 — no concurrency control on scan state → FIXED (best-effort lease)
`ScanRecord` lease is now real: acquired server-side before advancement,
renewed each checkpoint, released at terminal states, expired leases taken
over; foreign unexpired leases skip chunk work entirely (no appends).
`rescan` clears stale leases (admin override). Regression:
`test/scan-lease.test.ts` (block/no-append, takeover, terminal release,
self-renewal). HONEST RESIDUAL: without CAS-backed KVS this narrows rather
than eliminates the interleaving window; KVS consistency semantics under
concurrent put/get remain UNKNOWN (audit §6.4 item) until live verification.

### SEC-M1 — logger message field bypassed scrubbing → FIXED
Messages get the same bearer/token-pattern scrubbing as meta values.
Regressions added to `test/logger-scrub.test.ts`.

### SEC-M2 — provenance stamp loss rendered banner-less → FIXED
`showNonLiveBanner = dataMode !== 'LIVE'` with distinct UNVERIFIED-provenance
banner text. Regression in `test/provenance-ui.test.ts`.

### SEC-M3 — paged parsing not shared-by-construction → FIXED
See LOW 11 above; window parameter honored symmetrically.

### SEC-M4 (VERIFY-LIVE) — tenant namespace derivation across contexts → CHECKLIST (cannot be settled offline)
Recorded in §5 checklist. `deriveTenantId` already fails closed when neither
context field resolves; first-install logging of which field resolved is part
of the live checklist.

### SEC-M5 (VERIFY-LIVE) — resolver authorization rests on adminPage placement → CHECKLIST
Non-admin resolver-invocation test required at first install; if reachable,
add an explicit server-side permission assertion then. Not certifiable
offline and not invented now.

### SEC-L1 — CSV formula injection → FIXED
Leading `= + - @ \t \r` cell values are apostrophe-neutralized.
Regression in `test/export-hygiene.test.ts`.

### SEC-L2 — full emails persisted; sanitization overstated → FIXED
Adapters store LOCAL PART only (`emailHint('a@b') => 'a'`); comment updated;
service-account heuristic unchanged (local-part markers only, verified).

### SEC-L3 — dormant org-enrichment egress → UNCHANGED (correctly inert)
Guard intact (`enabled:false`, null key resolver, undeclared remote); A3
enable-time checklist stays BINDING (recorded in addendum).

### SEC-L4 — invocation amplification → DEFERRED (documented)
Admin-only audience mitigates; per-tenant rescan min-interval guard deferred
to post-live hardening backlog.

---

## 4. Additional defect found & fixed during this pass

- **Production `{groupId}` literal path**: `listConfluenceGroupMembers`
  requested `/wiki/rest/api/group/{groupId}/member?...` verbatim in
  production (substituted path and telemetry endpoint arguments were
  swapped). Invisible to fixture/replay tests; caught by the new
  live-shape parity test. Fixed; recorded as addendum A9.
- **`npm run fixture:scan` was broken** under plain Node strip-types
  (extensionless imports); script now uses the documented tsx runner.
- **`meta.total` misread**: wiki `size` (page size) is no longer treated as
  collection total.

## 5. VERIFY-LIVE checklist (must be retired by sourced live evidence only)

Carried from feasibility §9 / addendum A1 plus audit §6 additions:
1. Authenticated `forge lint/deploy/install` with registered app id.
2. Exact accepted scope strings per endpoint under installed-app identity —
   including `read:jira-work` on enhanced search (A1) and whether
   `read:avatar:jira` is droppable (A7).
3. `asApp()` acceptance for `/rest/api/3/users`, `/applicationrole`,
   `/wiki/rest/api/*` at required granularities.
4. Live pagination shapes: does `/rest/api/3/users` emit isLast/total?
   Does enhanced search terminate by token-absence (A1 assumption)?
5. Tenant context fields (`installationId` vs `cloudId`) availability and
   stability across resolver AND scheduled-trigger contexts (SEC-M4); pin one
   derivation, log resolution source tenant-safely.
6. Direct resolver invocability by non-admin users (SEC-M5); add explicit
   permission assertion if reachable.
7. Forge KVS consistency semantics under concurrent put/get (settles the
   lease residual); observe lease-skip logs under multi-tab load.
8. Org-admin API enablement path (only when product decides): A3 binding
   checklist (remote declaration + secret review).
9. Real-environment scan end-to-end; confirm hero/split against manual spot
   checks before any customer-facing claim.

## 6. Honest residual limitations

- Per-item money model understates simultaneous multi-user removals that
  cross band boundaries (F-MEDIUM 8) — conservative direction, disclosed.
- Zero-seat floor label cosmetic nit (F-LOW 10).
- Rescan pacing budget (SEC-L4) deferred.
- Everything in §5 is genuinely UNKNOWN until credentials exist; nothing in
  this candidate claims live behavior.

## 7. Factory direction

`state/factory_direction.json`:
`release_status=PARITY_READY_AWAITING_CREDENTIALS`, `continue=false`.
Per canonical card: parity gates pass, no material blocker remains, and only
real Atlassian credentials/live verification are missing. Next action on
credential arrival: register app (`forge register` fills the manifest id),
run authenticated lint/deploy/install, execute the §5 checklist top-down.

— release_integrator, 2026-08-26
