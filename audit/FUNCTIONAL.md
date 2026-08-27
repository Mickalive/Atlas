# ATLAS FUNCTIONAL RED TEAM AUDIT

**Auditor:** functional_redteam  
**Candidate:** commit `7c74838f5580f8fd2c9c141c1add3113304c5e3d` (127/127 tests PASS)  
**Date:** 2026-08-27  
**Scope:** Independent adversarial audit of correctness, financial integrity, risk classification, pagination, evidence model, fixture/live equivalence, and UX honesty.

---

## EXECUTIVE SUMMARY

The candidate is **solidly constructed**. All 127 regression tests pass. The core financial engine, risk classification, evidence model, and recommendation pipeline are correct under every tested scenario. No BLOCKER or HIGH severity findings exist. Two MEDIUM findings and three LOW findings are documented below. All previously claimed repairs (BLOCKER 1, BLOCKER 2, HIGH 3, HIGH 4, HIGH 5, MEDIUM 6, MEDIUM 7, MEDIUM 9) are verified as correctly implemented.

The most significant residual risk remains the **unverified live behavior** (UNKNOWN) — no finding below falsifies the code-level logic under fixture conditions. The findings below are either latent risks that manifest only with future pricing data, or honest residuals already documented in RELEASE_STATUS.md.

---

## FINDINGS

### F-LOW 1 — Latent negative-delta risk for annual fixed tiers (severity: LOW)

**Attack:** The `computeScenarioDelta` function in `src/core/finance/engine.ts` does not clamp `annualDeltaCents` to non-negative values. With annual fixed tiers (NOT currently sourced), removing seats can increase total cost when crossing tier boundaries upward.

**Reproduction:** Construct a `PriceDataset` with `billingMode: 'ANNUAL_FIXED_TIERS'` and tiers `{upToSeats: 100, perSeatAnnualCents: 8000}, {upToSeats: 250, perSeatAnnualCents: 7000}`. Call `computeScenarioDelta` with `currentBillableSeats: 105, seatsRemoved: 10`.

- `before = 105`, `after = 95`
- `beforeCost = 105 × 7000 = 735,000`
- `afterCost = 95 × 8000 = 760,000`
- `deltaCents = (735000 - 760000) × 1 = -25,000` (NEGATIVE)

The function returns a `MoneyEstimate` with `annualDeltaCents: -25000`. Downstream `computeTotals` adds this negative value to `safeNowAnnualCents`, potentially reducing the hero display to a negative number.

**Why it does not manifest now:** The only SOURCED pricing dataset is Jira Standard monthly progressive bands, where removing seats always reduces or maintains cost. All other products are `PRICING_UNKNOWN` and are skipped in `buildRecommendation`. The test dataset for annual tiers (`pricing.golden.test.ts` line 111-138) uses a synthetic `PriceDataset` that is never shipped.

**Why it still matters:** If annual tier pricing is sourced in a future cycle, this becomes a real financial display bug. The `buildRecommendation` function's merge logic (`else if (est.annualDeltaCents > 0)`) would skip negative-delta products when merging, but the first product's negative delta would be used as-is.

**Reproduction code:**
```typescript
const annualDataset: PriceDataset = {
  productId: 'jira', plan: 'STANDARD', billingMode: 'ANNUAL_FIXED_TIERS',
  status: 'SOURCED', modelVersion: 'test', currency: 'USD',
  effectiveDate: '2026-08-26', sourceUrl: 'n/a', notes: [],
  bands: [],
  tiers: [
    { upToSeats: 100, perSeatAnnualCents: 8_000 },
    { upToSeats: 250, perSeatAnnualCents: 7_000 },
  ],
  minimumBillableSeats: null, knownUpToSeats: 250,
};
const est = computeScenarioDelta(annualDataset, {
  currentBillableSeats: 105, seatsRemoved: 10, todayIso: '2026-08-26T00:00:00Z'
});
// est.annualDeltaCents === -25_000  (should be clamped to 0 or surfaced as WARNING)
```

**Recommendation:** Add `Math.max(0, deltaCents)` guard in `computeScenarioDelta`, or return a `QUOTE_REQUIRED` with a note that the reduction would increase cost. This is not blocking V1 since no annual tier dataset is shipped as SOURCED.

---

### F-LOW 2 — `buildRecommendation` merge skips negative-delta second products (severity: LOW)

**Attack:** In `src/core/recommend/recommend.ts` line 84, the merge condition `else if (est.annualDeltaCents > 0)` silently drops second products with zero or negative deltas from the combined estimate.

**Reproduction:** If two products are both SOURCED and bounded, the first has delta 0 (e.g., minimum floor) and the second has a positive delta, the second IS merged. But if the first has a positive delta and the second has delta 0, the second is SKIPPED. The combined estimate includes only the first product.

**Impact:** When a multi-product recommendation has one product at minimum floor (delta=0), that product's position description still appears in `crossings` but the zero delta is not explicitly counted. This is functionally correct (zero delta contributes nothing) but the `crossings` array may reference a product that contributed no delta.

**Why it does not matter now:** All V1 multi-product scenarios produce zero delta for at most one product (at minimum floor), so the merge is correct. But the asymmetric merge logic is fragile for future extensions.

---

### F-LOW 3 — `detectCrossings` produces redundant descriptions for multi-band drops (severity: LOW)

**Attack:** When a seat reduction crosses multiple band boundaries simultaneously, the `detectCrossings` function emits one crossing description per crossed boundary, all showing the same before/after values.

**Reproduction:** `detectCrossings(260, 100, jiraStandardDataset)` produces two entries:
1. "Seat count drops below the 101-250 band boundary (@ $7.30/seat): 260 -> 100"
2. "Seat count drops below the 251-500 band boundary (@ $6.10/seat): 260 -> 100"

Both are factually correct but the "260 -> 100" is repeated and the intermediate band boundary is not explained.

**Impact:** UX confusion only. The crossings are displayed in the recommendation card's MONEY section. An admin seeing two "drops below" entries with the same before/after might wonder why there are two. The financial math is unaffected.

**Why it still matters:** Minor UX polish. The descriptions could be improved to show the progressive band traversal (e.g., "crosses from 251-500 band through 101-250 band").

---

### F-MED 1 — Pool policy ambiguity between PRODUCT_CONTRACT.md and PRODUCT_V1.md §5.5 (severity: MEDIUM)

**Attack:** PRODUCT_CONTRACT.md and the factory_direction.json claim "Seat counts above knownUpToSeats → bounded=false; such estimates never enter aggregate totals." However, the actual behavior documented in PRODUCT_V1.md §5.5 is more nuanced: when a recommendation holds BOTH a SOURCED product (within range) and an UNSOURCED product, the SOURCED portion's delta IS included in `safeNowAnnualCents` / `reviewPoolAnnualCents`, while the card is counted as `quoteRequired`.

**Reproduction:** A user holds Jira Standard (SOURCED, 450 seats, bounded) and Confluence (PRICING_UNKNOWN). `buildRecommendation` produces:
- `money.annualDeltaCents` = Jira delta (positive)
- `money.bounded` = false
- `computeTotals`: `safeNowAnnualCents += JiraDelta` (ADDED), `quoteRequiredCount += 1`

**Impact:** The hero dollar display INCLUDES the sourced Jira portion. An admin sees a dollar amount that correctly represents defensible savings. This is the BETTER behavior. But the narrower claim in PRODUCT_CONTRACT could mislead future auditors into thinking NO dollars should appear for partially-bounded cards.

**Recommendation:** Align PRODUCT_CONTRACT.md language with PRODUCT_V1.md §5.5: "Sourced portions enter aggregate totals; cards with ANY unbounded component are also counted as quote-required."

---

### F-MED 2 — `itemsFetched` counter excludes zero-hit Confluence sentinels (severity: MEDIUM)

**Attack:** In `src/backend/scanService.ts` line 788, `rec.streams.contributionQueries.itemsFetched += page.values.length` counts only actual Confluence hits. Zero-hit sentinel rows (`{ contentId: null, lastModified: null, ... }`) are appended to storage but not counted.

**Reproduction:** For an account with no Confluence activity, the contribution query returns an empty array. The scan service appends a zero-hit sentinel (`page.values.length === 0`) and does NOT increment `itemsFetched`. The stream telemetry therefore shows fewer items fetched than accounts actually queried.

**Impact:** Telemetry accuracy only. The sentinel rows are correctly stored and processed by `buildContributionMap`. Classification is unaffected. But an admin or operator reading `itemsFetched` would undercount the actual query volume.

**Recommendation:** Increment `itemsFetched` by 1 for each sentinel appended, or by the total accounts queried per batch.

---

### F-LOW 4 — Scan lease race condition is honest but not provably safe (severity: LOW)

**Attack:** The scan lease in `src/backend/scanService.ts` uses a read-check-write cycle that is not atomic. Two concurrent invocations can both pass the lease check before either persists, causing potential double-appends of acquisition rows.

**Reproduction:** The `scan-lease.test.ts` tests verify the lease blocks concurrent invocations, but the test uses `memoryStorage` which provides synchronous consistency. Under Forge KVS, the read and write may not be atomic, creating a window for interleaving.

**Mitigation in code:** The lease TTL is `Math.min(Math.max(budgetMs * 2, 60_000), 1_800_000)` which bounds the window. The `derive` phase deduplicates users by `accountId` (FP-26 fix in `derive.ts` line 126), so double-appended user rows collapse. Double-appended membership or contribution rows could inflate counts but would not create false classifications.

**Documented in:** RELEASE_STATUS.md under "Honest residuals": "The best-effort KVS scan lease cannot be called race-proof until live Forge concurrency semantics are observed."

**Impact:** The race window is narrow (bounded by chunk execution time), the user deduplication prevents phantom users, and the worst case is inflated membership counts that do not affect classification correctness.

---

### F-LOW 5 — `buildPerUserActivity` uses first signal kind for multi-kind observations (severity: LOW)

**Attack:** In `src/core/evidence/evidence.ts` line 197:
```typescript
signals.push({
  kind: [...obs.kinds][0],
  ...
});
```
When a user has both `ISSUE_AUTHORSHIP` and `ISSUE_ASSIGNMENT` signals for Jira, only the first kind (by Set iteration order) is used as the signal kind. The other kinds are lost from the emitted signal.

**Reproduction:** A user who authored AND was assigned to issues has `obs.kinds = Set(['ISSUE_AUTHORSHIP', 'ISSUE_ASSIGNMENT'])`. The emitted signal uses whichever `.next()` returns first. The recommendation card evidence shows only one signal kind instead of both.

**Impact:** Minor evidence traceability loss. Both kinds are still tracked internally via the Set and affect `hasAnyPositiveSignal`. But the emitted evidence line shows only one kind, reducing the evidence detail available to the admin.

**Recommendation:** Emit multiple signals (one per kind) or use a combined kind like `ISSUE_ACTIVITY`.

---

## VERIFIED CLAIMS (all SAFE NOW classifications hold)

### SAFE NOW corroboration rule (CORRECT)
Every SAFE_NOW path requires ≥2 independent product signals. The two paths are:
1. `RULE_CORROBORATED_ABSENCE`: ≥2 fully-drained negative sweeps, account age > window, non-protected
2. `RULE_CORROBORATED_STALENESS`: ≥2 corroborating surfaces (stale positives + drained negatives), non-protected

No single-surface path can produce SAFE_NOW. Verified by tracing all return paths in `classifyAccount`.

### Protected class exclusion (CORRECT)
Admin-like groups, service-account heuristics, explicit exceptions, and deactivated accounts are structurally excluded from SAFE_NOW. Protected users with measured absence reach at most REVIEW. Verified by FP-08, FP-09, FP-10 tests.

### Missing evidence never produces SAFE (CORRECT)
`RULE_DATA_UNAVAILABLE` fires when any evidence has `dataUnavailableReason !== null`, forcing UNKNOWN. The `RULE_INSUFFICIENT_OBSERVATION` path forces UNKNOWN for accounts younger than the observation window. Verified by FP-07, FP-18 tests.

### Minimum seat floors (CORRECT)
`applyMinimumSeats` is applied independently to both before and after states. When `before === after` (removal stays inside the floor), delta is 0. Verified by FP-25 tests and direct computation.

### Progressive band math (CORRECT)
The golden anchor `450 seats = $3,175.00/month` is verified. Band integration correctly handles segment counts as `(segmentTop - fromSeats + 1)`. Boundary crossings are detected accurately for all 12 boundary cases. Verified by `pricing.golden.test.ts` and direct computation.

### Rounding policy (CORRECT)
`displayDollarsFromCents` uses `Math.floor(cents / 100)` — never rounds up. Hero display is `floor(exactSum / 100)`, and `hero - sumOfFloors < numItems` is mathematically guaranteed. Verified by `FP-S3`, `FP-S4` tests and exhaustive 0-199 cent fuzz.

### Pagination drain safety (CORRECT)
Unknown continuation states (`isLast === null`) produce DEGRADED streams and PARTIAL scans. The fingerprint guard prevents infinite spinning on offset-ignoring responders. Verified by HIGH-5a..5d tests.

### Fixture/live transport equivalence (CORRECT)
Both gateways route through the same `parseWire*` adapter functions. The `ReplayGateway` test proves byte-identical reports from recorded fixture data. Live-shape tests (`LIVE-SHAPE-2`) prove the BLOCKER 1 repair: Confluence `version.when` is preserved through adapters.

### Org evidence merge (CORRECT)
`mergedOrgLastActiveForProduct` takes MAX recency per product, never positional first match. Fresh product-specific observations correctly shadow stale org-wide copies. Verified by BLOCKER 2 repair tests and direct `mergedOrgLastActiveForProduct` unit tests.

### Population totals (CORRECT)
`computeTotals` uses population-level `keepCount`/`unknownCount` overrides, not emitted card counts. The KEEP_UNKNOWN_CARD_CAP (500) only limits emitted cards, not totals. Verified by HIGH-4 repair tests.

### Partial sweep safety (CORRECT)
An undrained Jira sweep degrades EVERY jira seat's evidence via `dataUnavailableReason`. Only the conflicting-recent-signal screen (which runs before evidence sufficiency) preserves KEEP for genuinely recent users. Stale-prefix users drop to UNKNOWN. Verified by HIGH-3/3b repair tests.

---

## HONEST RESIDUALS (not findings, documented risks)

1. **No authenticated Forge/live evidence.** All 127 tests run under fixture transport. Live API behavior for `emailAddress` visibility, `read:avatar:jira` necessity, Confluence `totalSize` reliability, and KVS concurrency semantics remain UNKNOWN. These are documented in PRODUCT_V1.md §16 and API_FEASIBILITY.md §9.

2. **Eight moderate dependency advisories** through Atlaskit/Forge dependencies; no high/critical advisory fails the release gate.

3. **Branch protection not certified** as active on the public repository.

4. **Stale `factory/continuation` branch** exists at GitHub-ref level; current automation neither reads nor writes it.

---

## CONCLUSION

The candidate baseline is functionally sound. Every SAFE NOW classification is correctly gated by corroboration, window completeness, protected-class exclusion, and evidence sufficiency. The financial engine correctly integrates progressive bands, applies minimums to both sides, never rounds up, and flags unbounded estimates honestly. The recommendation pipeline deduplicates multi-group seats, labels ride-along products, and maintains a single pool policy across dashboard, CSV, and markdown exports.

The two MEDIUM findings (F-MED 1 pool policy ambiguity, F-MED 2 counter accuracy) are documentation/telemetry issues, not correctness defects. The three LOW findings (F-LOW 1 negative delta, F-LOW 2 merge skip, F-LOW 3 redundant crossings) are latent risks that do not manifest under current V1 pricing data.

**No finding blocks release to PARITY_READY_AWAITING_CREDENTIALS.** The candidate correctly handles all tested scenarios and honestly documents all unverified boundaries.
