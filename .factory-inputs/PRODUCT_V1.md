# ATLAS PRODUCT_V1 — FROZEN SPECIFICATION

Owner: `market_product_architect` · Status: FROZEN for this factory cycle · Researched/frozen: 2026-08-26

Precedence (per builder dispatch): verified API feasibility controls platform facts; stricter security controls safety; **this document controls product scope, UX and money framing** where technically and safely feasible.

---

## 0. Frozen product sentence

**Atlas turns your Atlassian license bill into a renewal-ready action list: what to cut, why it is safe, and exactly how many dollars it saves before your next renewal.**

V1 is a *read-only renewal audit*. It produces one principal number — **ESTIMATED ANNUAL SAVINGS** — decomposed into defensible pools, with every recommendation explainable as WHAT / WHY / MONEY / RISK / EVIDENCE.

Target time-to-value: install → authorize minimal read scopes → automatic scan → dollars on screen, under five minutes.

---

## 1. Market snapshot (researched 2026-08-26)

The niche is proven and crowded. "Find inactive users and save money" is no longer a differentiator; several Cloud/Forge products shipped or major-versioned within the last 90 days.

| Competitor | Shape (as of Aug 2026) | Strength | Exploitable weakness |
| --- | --- | --- | --- |
| **Recoup — License Cost Optimizer** (Taskhooker Pty Ltd, Forge-native Jira Cloud, v5.2.0, Jun 3 2026) | Cross-product Jira+Confluence+JSM+JPD scan; inactive / product-mismatch / idle-JPD detectors; per-recommendation dollars; service-account safeguards; two-consecutive-scan approve queue; reclaim = removal from mapped access groups under org-admin identity, reversible; immutable CSV audit log; now paid-via-Atlassian | Closest analog to Atlas: deterministic, Forge-hosted, cross-product dollars | Flat per-seat dollar framing (no tier/band-boundary math surfaced); marketing overclaim ("average customer reclaims ~25× subscription cost"); reclaim-first trust model |
| **UserLens — License Optimization for Jira & Confluence** (Forge, v3.2.0, May 2026) | Ghost-seat detection via 5 activity signals (assignments, comments, transitions, edits, worklogs); CFO-ready PDF reports; 100% read-only, zero write permissions; free ≤10 users | Read-only positioning validates our low-friction wedge | Jira+Confluence only; per-seat estimates; no renewal framing or tier math |
| **Cadence: License Management & Inactive Users for Jira** (v5.4.0, Aug 2 2026) | Issue-activity shortlist (assignee/reporter/creator on updated items); explicitly states apps get **no last-login field** from Jira; broader SaaS renewal radar + Slack/Discord + AI overlap flags | Honest evidence expectations; renewal-date awareness | Scope drift into generic SaaS spend + AI features our finance buyers distrust |
| **SeatSaver** (Cloud, launched Jun 13–15 2026) | Inactive scan + "instant ROI" monthly-savings calc + one-click bulk revoke + CSV export | Speed, simplicity | One-click revoke of "zombie accounts" is precisely the false-positive machine Atlas refuses to be |
| **License cost Optimizer for Jira Free** (free, active Jul 31 2026) | Automated suspend-by-inactivity rules (daily/weekly/monthly), bulk enable/disable/revoke | Free, automation | Automation-without-review posture; compliance teams flinch |
| **User Management and License Optimizer for Jira & Confluence** (listed since 2012, v4.6.0 Aug 4 2026) | Multi-site deactivate/offboard at scale, scheduled cleanup, SOC 2/ISO 27001/GDPR audit trails | Enterprise compliance credibility | Deactivation tooling first, money second; heavy admin-console feel |
| Atlassian native (admin.atlassian.com + org API + JQL `inactiveUsers()`) | Manual last-active view/export, bulk disable; Organization REST API exposes user last-active dates (org-admin context); Atlassian KB confirms native UI **cannot automate** inactive-user removal | Free and authoritative data source | Manual, per-product-blind (a Confluence-active user looks "inactive in Jira"), no dollar quantification, no renewal math |

Structural tailwind: Atlassian's own pricing page states Data Center end-of-sale was 2026-03-30 with end-of-life 2029-03-28. The license-optimization buyer population is consolidating on Cloud, where seats are billed continuously (progressive bands / MQB / annual tiers) and waste compounds monthly. DC-only optimizers (e.g., License Optimizer for Jira, Smart License Manager) are riding a shrinking installed base.

### Strategic conclusions (binding for V1)

1. **Demand exists; differentiation must be trust + renewal execution.** We do not compete on detector count or "cut costs by up to 30%" claims. We win on defensible evidence, conservative classification, honest partial scans, and numbers framed against the actual renewal event.
2. **Tier-boundary intelligence is our sharpest technical edge.** Atlassian Cloud uses progressive per-seat bands (monthly) and fixed annual tiers; the marginal value of removing a seat depends on which band/tier boundary it crosses. Competitors display flat per-seat dollars. Atlas computes `cost(currentSeats) − cost(reducedSeats)` on versioned band/tier tables and calls out crossings explicitly ("removing 12 seats drops you out of the 251–500 band").
3. **Read-only V1 beats reclaim-first V1 for installation velocity.** Zero write scopes → lowest consent friction → fastest install-to-dollars. Remediation ships later behind full preview/confirm/audit/rollback gates (mandated by `PRODUCT_CONTRACT.md`).
4. **Never copy Recoup.** Same problem space, opposite trust posture: they optimize reclaim throughput; Atlas optimizes zero false-positive removals and finance-defensible reporting.
5. **Native-tool coexistence, not replacement:** Atlas automates and joins what admin.atlassian.com leaves manual, and quantifies it. Listing copy may honestly reference the native gap.

---

## 2. Frozen V1 scope

### 2.1 IN — feature set

| # | Feature | Frozen definition |
| --- | --- | --- |
| F1 | Read-only inventory scan | Enumerate licensed users and product access per connected site for every product graded GO/DEGRADED in `docs/API_FEASIBILITY.md`. Jira alone is the minimum sellable scan (§2.3 ladder). |
| F2 | Evidence model | Per user × product: last-observed activity timestamp(s), signal types used, and the observation window actually covered (default target 180 days). Never-observed activity inside a partially covered window MUST NOT be treated as long-term inactivity. |
| F3 | Classification engine | Every flagged account gets exactly one class: `SAFE_NOW`, `REVIEW`, `KEEP`, `UNKNOWN`. Protected classes (org/site admins, probable service/technical accounts, explicit admin exceptions) are never `SAFE_NOW` without an explicit recorded exception. Deterministic rules only; thresholds configurable, conservative defaults (§4). |
| F4 | Financial engine | Versioned pricing datasets per product × plan × billing mode implementing progressive bands (monthly) and annual tier tables. Savings are always scenario deltas `cost(before) − cost(after)`, never seats × flat price. Handles band/tier boundary crossings, Maximum Quantity Billing (monthly), renewal timing (annual). Assumptions always exposed; admin rate overrides allowed and visibly labeled. (§5.) |
| F5 | Money-first dashboard | Hero metric ESTIMATED ANNUAL SAVINGS split into *Safe now* and *Review* pools; per-product breakdown; top recommendations; scan-completeness indicator. No vanity metrics on screen one. (§3.) |
| F6 | Renewal planner lite | Optional admin-entered next-renewal date per site/product. Drives days-to-renewal, exposure-until-renewal, and an exported renewal action brief (CSV + Markdown) with owner placeholders, dollar values, risk class, evidence summary. This is V1's "execution": board-ready material, zero writes. |
| F7 | Recommendation cards | WHAT / WHY / MONEY / RISK / EVIDENCE rendered for every recommendation (§4). |
| F8 | Fixture/demo mode | Development/demo transport behind the same gateway interface under §6 hard rules. Not selectable by installed customers in production builds. |

### 2.2 OUT — explicit non-goals for V1

Any write/remediation/deactivation (deferred V1.x behind full gates); scheduled/background rescans; multi-site/org rollup dashboards; PDF generation (CSV/Markdown suffices); benchmarking vs other companies; AI/LLM summaries or scores; Slack/Discord/email integrations; Data Center/Server support; mobile; generic SaaS spend tracking (Cadence-style vendor radar); chatbot; customer-facing "try demo" button in production builds.

Each exclusion passes the kill test: it does not directly raise install → credible-dollars → pay probability within this cycle.

### 2.3 Feasibility-conditioned degradation ladder

Coverage claims follow `docs/API_FEASIBILITY.md` verdicts. Ship the deepest fully-supported rung; never claim an unsupported one:

- **L1 (minimum sellable):** Jira licensed-seat audit + issue-derived activity evidence + money engine + dashboard + exports. Must ship even if all other products are DEGRADED/BLOCKED.
- **L2:** + Confluence seats & contribution evidence.
- **L3:** + JSM agent seats & agent activity evidence.
- **L4:** + JPD creator seats & creator activity evidence.

Known UNKNOWNs carried into the feasibility map (do not design around unverified behavior): product REST APIs reportedly expose no last-login field (activity must be inferred); organization-level last-active dates may require org-admin context whose availability inside a Forge app is unverified. Until verified, the evidence schema treats "no login field" as normal and any org-API enrichment as additive evidence only.

---

## 3. Money-first UX specification

1. Dashboard (default route): hero `ESTIMATED ANNUAL SAVINGS` (point estimate + expandable assumptions); beneath it `Safe now: $X · Review pool: $Y`; third line scan status (products scanned, window coverage, timestamp, `dataMode` badge).
2. Renewal strip: if date set — countdown, exposure until renewal, potential reduced-renewal figure; if unset — prominent single-field prompt plus explained default (forward 12-month horizon) labeled an estimate basis.
3. Recommendation list: sorted by dollar value within risk class; `SAFE_NOW` before `REVIEW`; `KEEP`/`UNKNOWN` collapsed by default with counts visible.
4. Per-product breakdown table: product, licensed seats, estimated annual cost (model version shown), safe-now savings, review-pool savings, band/tier position, boundary-crossing callout icon when applicable.
5. Exports (CSV + Markdown renewal action brief) carry: generated-at, scan window coverage, `dataMode`, pricing-model version + effective date, full assumptions block.
6. Honesty affordances: partial-scan banner persists until a complete scan succeeds; overridden rates visually marked; every dollar figure traces to its formula (`inputs → bands → arithmetic`) in-app.

No screen leads with user counts. Dollars first, always.

---

## 4. Recommendation model (frozen semantics)

Every recommendation carries:

- **WHAT**: account(s)/seat(s) affected, product, current access path(s) (direct/group).
- **WHY**: deterministic rule that fired (rule id + threshold values), e.g., ≥90d without observed activity; redundant multi-group access; product mismatch.
- **MONEY**: modeled annual delta incl. model version, band/tier position before/after, boundary-crossing callout when applicable.
- **RISK**: class (`SAFE_NOW`/`REVIEW`/`KEEP`/`UNKNOWN`) plus dependency checks evaluated (admin flag, service-account heuristics hit, exception-list membership, recent account creation, cross-product activity).
- **EVIDENCE**: concrete observations with counts/timestamps/sources sufficient for a human to re-derive the conclusion.

Conservative defaults (configurable, hardcoded as shipped defaults):

- Inactivity ≥90 days ⇒ at best `REVIEW`.
- `SAFE_NOW` requires ALL of: strong-evidence rule fired; low dependency risk; full observation-window coverage; non-protected class; no conflicting signal.
- Missing/unverifiable activity ⇒ `UNKNOWN`; never `SAFE` because a field was absent (parity rule #9).
- Any recent human activity signal ⇒ `KEEP`.
- Protected classes (admins, probable service accounts, explicit exceptions) are excluded from `SAFE_NOW` unless the admin records an explicit exception acknowledging responsibility.

Inactivity is a signal, not proof. False-positive-driven removal outranks savings maximization as the worst failure.

---

## 5. Financial engine requirements (frozen)

Grounded in current Atlassian licensing behavior (atlassian.com/licensing/cloud, jira pricing pages; retrieved 2026-08-26):

1. **Versioned datasets**: `{product, plan, billingMode, bands[]/tiers[], unit prices, currency, effectiveDate, sourceUrl}`. Shipped snapshot uses published list prices; admin overrides allowed and always labeled; effectiveDate older than 180 days renders a visible staleness warning.
2. **Progressive band math (monthly)**: cost = Σ per-band segments. Golden test from Atlassian's own example: Jira Standard monthly, 450 seats = ($8.60×100)+($7.30×150)+($6.10×200) = **$3,175.00/month** — must exist as an automated test.
3. **Annual tiers**: billed by tier matching user count; changes realize at renewal/upgrade quote. Annual-contract seat reductions produce savings **at the next renewal**, and Atlas states this.
4. **MQB (monthly)**: peak-seat billing; mid-cycle removal does not reduce the current invoice. All monthly-mode savings labeled "effective from next billing period". Never present in-cycle refunds.
5. **Scenario deltas only**: recompute both states on the versioned curve; detect/report boundary crossings. Naïve seats × unitPrice outputs are forbidden anywhere in UI, exports, logs.
6. **Estimate labeling**: unknown customer plan/billing ⇒ stated defaults used inline and flagged `pricingConfidence: ASSUMED`; negotiated-rate override flips to `CUSTOM_RATES` while remaining labeled.
7. **Rounding**: exact decimal arithmetic internally; display rounding only at presentation; aggregates summed exactly then rounded once (never sum-of-rounded).
8. **Traceability**: every monetary output carries `{modelVersion, datasetEffectiveDate, inputs, formula}` retrievable in-app.
9. **Purity**: pricing/risk/evidence/recommendation logic is pure and independent of Atlassian transport (`FORGE_PARITY_MODE.md` requirement #10).

---

## 6. Fixture/demo mode — HARD RULES (owner directive)

Owner directive, verbatim constraints: **fixture/demo mode must be visibly non-live and cannot alter actual product logic.**

1. **One pipeline.** Exactly one scanner consumes the Atlas-owned gateway interface (`AtlassianGateway → inventory/users/groups/activity/access`). Exactly two adapters: `ForgeAtlassianGateway` (production) and `FixtureAtlassianGateway` (deterministic fixtures per `docs/FORGE_PARITY_MODE.md`). Everything downstream is shared — there is no demo scanner, demo engine or demo code path.
2. **No logic divergence, mechanically enforced.** No conditional on fixture/live mode may exist inside normalization, evidence, risk, financial, recommendation or UI-model modules. Enforcement (builder must implement both): (a) CI static check rejecting mode-dependent conditionals/branches in those modules; (b) parity equivalence test proving byte-identical engine outputs when both adapters return equivalent responses.
3. **Visibly non-live everywhere.** While fixture mode is active: persistent unmissable header banner `DEMO DATA — NOT A LIVE SCAN`; `FIXTURE DATA` badge/watermark on dashboard, cards and every export; persisted scan records tagged `dataMode:"FIXTURE"` and rejected by live-report rendering paths; all log lines prefixed `[FIXTURE]`; fixture identities synthetic (`accountId` pattern `fixture-*`, tenant name `ATLAS PARITY DEMO`) so nothing can be mistaken for tenant data in storage or exports.
4. **Developer-only activation.** Fixture mode activates solely through development/test configuration; production builds contain no runtime switch, UI toggle or route enabling it. A customer-facing guided demo is deliberately deferred and requires its own visibly-labeled sample-workspace design plus human sign-off post-V1.
5. **Fixtures exercise the real logic.** Fixture datasets cover every mandatory scenario in `docs/FORGE_PARITY_MODE.md` (active / 30-60-90-180d inactive / never-active / admin / service-account / single-group access / multi-group redundancy / Jira-only vs Confluence-only evidence / JSM agent-like / JPD creator-like where feasible / missing activity / insufficient permissions / pagination / 429-recovery / partial failure / pricing boundary cases), so the identical downstream code that will run live is what gets validated.

---

## 7. Free → paid boundary (frozen)

- **Free tier:** sites with up to 10 licensed users get the entire read-only product free (mirrors established Marketplace norm; keeps free genuinely useful — full scan, full report, exports).
- **Paid:** above 10 licensed users, paid via Atlassian with the standard trial period; final price points are DECISION-PENDING-HUMAN before listing (default suggestion: entry band consistent with comparable optimizer listings; do not hard-code a number anywhere in product code).
- The value gate is tenant size, not feature crippling: no paywalled buttons inside V1.
- Post-V1 monetization attaches to features that earn it: scheduled rescans/monitoring, renewal history, remediation workflow, multi-site rollup. None exist in V1, so none are advertised.

---

## 8. Acceptance criteria (each maps to automated tests; red teams attack these)

| # | Criterion | Test anchor |
| --- | --- | --- |
| AC1 | Five-minute money moment: install → hero dollars requires ≤6 admin interactions post-install (authorize, run scan default-on, view). Documented walkthrough in repo. | walkthrough doc + UI route test |
| AC2 | Dashboard renders ESTIMATED ANNUAL SAVINGS as hero with Safe-now/Review split before any user-count metric. | UI snapshot test |
| AC3 | Manifest declares zero write/elevated scopes beyond verified read needs for shipped ladder rung. | manifest lint test + security plan cross-check |
| AC4 | Financial engine passes progressive-band golden case ($3,175.00/mo @450 Jira Standard monthly) and ≥10 boundary-crossing cases incl. annual tier steps. | unit tests on pricing engine |
| AC5 | MQB semantics: monthly-mode outputs never claim current-period refund; annual-mode savings labeled "at next renewal". | unit tests + copy assertions |
| AC6 | Missing activity ⇒ `UNKNOWN`; partially covered window suppresses `SAFE_NOW` for never-observed accounts. | risk-engine false-positive tests |
| AC7 | Protected classes never `SAFE_NOW` without recorded explicit exception. | risk-engine tests |
| AC8 | Partial scans render completeness indicator; aggregates from partial data are visibly labeled partial; incomplete scans never labeled complete (parity rule #8). | pipeline tests |
| AC9 | Demo-mode visibility: banner + export watermark + `dataMode:"FIXTURE"` persistence + `[FIXTURE]` log prefix all present in fixture runs; absent in live-configured runs. | integration tests |
| AC10 | Zero fixture/demo conditionals inside normalization→recommendation/UI-model modules (static check passes); parity equivalence test green (identical downstream outputs from equivalent adapter responses). | CI static check + equivalence test |
| AC11 | Every recommendation card renders WHAT/WHY/MONEY/RISK/EVIDENCE with re-derivable evidence counts/timestamps. | card render tests |
| AC12 | Pricing dataset versioned w/ sourceUrl+effectiveDate; stale (>180d) triggers visible warning; overrides always labeled. | pricing metadata tests |
| AC13 | Exports carry assumptions block, window coverage, `dataMode`, model version; aggregate = exact-sum-then-round (no sum-of-rounded drift). | export tests |

Kill-test gate for any scope addition during build: does it directly raise install → credible-dollars → pay probability this cycle? If not, defer.

---

## 9. Open UNKNOWNs & lane dependencies

1. **API feasibility (api_architect)** decides which ladder rungs ship: user inventory breadth, activity-signal availability per product, group-membership read paths, JSM/JPD seat semantics, org-API accessibility from Forge. This spec's F1/F2 degrade gracefully by design; L1 must survive worst-case feasibility.
2. **Security plan (security_test_architect)** owns final scope list, storage minimization and tenant isolation rules; AC3 defers to stricter security findings.
3. **Pricing certainty**: list prices change ~2×/year and negotiated discounts exist; engine treats shipped prices strictly as versioned estimates (§5), never as customer billing truth.
4. **DC dates**: end-of-sale 2026-03-30 and EOL 2029-03-28 per Atlassian's pricing page (retrieved 2026-08-26); irrelevant to V1 (Cloud-only) but re-verify before citing in marketing copy.

---

## 10. Handoff notes

- **implementation_builder:** implement §2–§6 exactly; AC1–AC13 are the definition of done for product scope; resolve any conflict with feasibility/security conservatively and record the deviation in your handoff rather than silently widening or narrowing scope.
- **functional_redteam:** highest-value attacks are AC4 boundary math, AC5 billing-semantics honesty, AC6/AC7 false-positive suppression, AC10 parity divergence, AC13 rounding drift.
- **security_redteam:** verify AC3 scope minimality, AC9/AC10 fixture-live separation (a fixture record surfacing in a live path is a BLOCKER), and absence of demo activation routes in production builds.
- **release_integrator:** V1 ships read-only at the deepest feasible ladder rung; status `PARITY_READY_AWAITING_CREDENTIALS` is correct once AC1–AC13 pass under `docs/FORGE_PARITY_MODE.md` gates without live credentials.

---

## Sources (retrieved 2026-08-26)

- Recoup — License Cost Optimizer: marketplace.atlassian.com/apps/3617258636 · recoup.taskhooker.com
- UserLens: marketplace.atlassian.com/apps/1207649677
- Cadence: marketplace.atlassian.com/apps/2729885846
- SeatSaver: marketplace.atlassian.com/apps/1944545581
- License cost Optimizer for Jira Free: marketplace.atlassian.com/apps/184784481
- User Management and License Optimizer: marketplace.atlassian.com/apps/1211109
- Atlassian Cloud licensing (progressive bands example, MQB, annual tiers): atlassian.com/licensing/cloud · atlassian.com/software/jira/pricing · support.atlassian.com/jira-cloud-administration/docs/explore-jira-cloud-plans/
- Native-tooling gaps (no native automation of inactive-user removal; org last-active API; JQL inactiveUsers()): support.atlassian.com/jira/kb/disable-or-remove-inactive-jira-users-in-bulk-in-jira-cloud/ · support.atlassian.com/jira/kb/find-inactive-jira-cloud-users-without-using-third-party-apps/ · developer.atlassian.com/cloud/admin/organization/user-last-active-dates/

