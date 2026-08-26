# BUILDER HANDOFF — implementation_builder, cycle 2026-08-26

Status: **candidate complete; all local gates green.** Not yet audited by the
red teams; no live Atlassian credentials exist in this environment, so
`forge lint/deploy/install` remain impossible (expected; see FORGE_PARITY_MODE).

## 1. What exists now

A real, runnable Forge-shaped V1: read-only renewal audit producing
ESTIMATED ANNUAL SAVINGS with defensible evidence, conservative risk classes,
tier-aware money math and honest partial/fixture semantics.

### Layout

```
manifest.yml                  nodejs24.x, 9 read scopes, licensing.enabled,
                              adminPage + resolver + scheduledTrigger(fiveMinutes)
src/core/                     PURE pipeline (no transport, no mode concept)
  types.ts                    canonical vocabulary incl. DataMode provenance stamp
  normalize/                  Wire DTOs -> canonical users/roles/plans (ERR-6 tolerant)
  evidence/                   per user x product signals, NEGATIVE_SWEEP semantics,
                              malformed-payload preservation
  risk/classify.ts            deterministic classification; SAFE_NOW corroboration
                              rule; protected-class screens; BLK-1 structurally blocked
  finance/                    versioned price tables + scenario-delta engine
                              (progressive bands, annual tiers, minimums, MQB timing)
  recommend/                  WHAT/WHY/MONEY/RISK/EVIDENCE cards + exact-cent totals
  uimodel/dashboard.ts        money-first view models (hero -> split -> status)
  export/exporters.ts         CSV + Markdown briefs with full honesty blocks
  pipeline/derive.ts          AcquisitionSnapshot -> FinalReport (pure)
src/gateway/
  types.ts                    THE Atlas-owned interface + scope budget map
  adapters.ts                 shared raw-response parsing (both transports route here)
  pacing.ts                   Retry-After floor, seeded jitter backoff, ceilings
  forge/forgeGateway.ts       production transport (lazy @forge/api; injectable for tests)
  fixture/                    deterministic transport + dataset + fault variants
src/backend/
  storage.ts                  tenant-scoped typed KVS wrapper, key-injection validation
  scanService.ts              checkpointed chunk engine (QUEUED->RUNNING->COMPLETE/PARTIAL)
  index.ts                    PRODUCTION composition root + resolvers (LIVE only, no
                              fixture import path); server-side tenant derivation
  logger.ts                   scrubbing logger (LOG-1/2)
src/frontend/dashboard.jsx    UI Kit money-first dashboard
src/dev/                      explicit-mode harness ONLY (ATLAS_DATA_MODE=fixture)
scripts/static-gates.mjs      GATE-2/4, AC10-static, ADV-3, purity, LOG-3 patterns
test/                         97 tests across 8 suites (see section 3)
docs/                         this file, addendum, walkthrough, parity assertions
```

## 2. Conflict resolutions (conservative, all recorded)

See `docs/API_FEASIBILITY_ADDENDUM.md` for the full record. Summary:

1. Added `POST /rest/api/3/search/jql` + classic `read:jira-work` as a
   RECORDED DEVIATION (VERIFY-LIVE) because L1 activity evidence is mandatory
   and feasibility §4 sanctions the signal without naming the endpoint.
2. Dropped the audit-log stream + `read:audit-log:jira` (SEC-2 zero-use).
3. Org-API enrichment compiled but disabled; remote undeclared (strictest of
   feasibility-constraints vs security SEC-2c).
4. Shipped ladder rung L2/L3 with degraded-confidence labels instead of L1-only;
   L4 JPD limited to plan status (UNKNOWN seats preserved).
5. Only golden-anchored Jira Standard monthly bands marked SOURCED; all other
   pricing PRICING_UNKNOWN → quote-required (BLK-7 protection). Engine supports
   annual tier tables and is fully tested for when sourced data lands.
6. SAFE_NOW requires org last-active OR two independent drained surfaces ≥90d
   with full window coverage and zero protected-class hits — implemented
   literally from feasibility §4.
7. Risk analysis covers UNKNOWN-status seats (Confluence candidates); only
   reclaim/money is restricted to provably billable seats.

## 3. Verification performed (all green)

| Gate | Evidence |
|---|---|
| Unit + integration suites | `npm test` → 97 tests / 8 files pass (pricing golden+boundaries, FP-01..FP-28 matrix through the real service+fixture transport, pacing/errors, isolation, logger scrubbing, provenance/UI, parity equivalence, memory ceiling) |
| Typecheck | `npm run typecheck` clean (TS strict) |
| Static gates | `npm run lint` green: GATE-2 scope budget == manifest == allowlist; GATE-4 fixture hygiene; AC10 no-mode-conditionals in core; ADV-3 prod entrypoints cannot reach sample transport; core purity (no @forge/node imports); LOG-3 secret patterns |
| Build | `npm run build` = gates + typecheck |
| Parity container | `.github/scripts/forge-parity-check.sh` → docker image built, runs Node 24 / 512MB / 512MB tmpfs / `--network=none`, installs latest `@forge/cli`, prints `FORGE_PARITY_GATE=PASS` |

Key adversarial cases proven by tests: false-positive suppression for
never-observed/malformed/recent/admin/service/exempt/deactivated accounts;
redundant multi-group money dedup; cross-product conflict → KEEP; truncated
pagination → PARTIAL with scoped totals; 403 → degraded stream with surfaced
permission reasons and zero fabricated savings; 429 Retry-After recovery to
COMPLETE; byte-identical outputs from fixture vs replay transports; 60k-user
derivation under memory ceiling.

## 4. Known limitations & honest gaps (not hidden)

1. **Live behavior unverified** — feasibility §9 items L1–L7 (asApp acceptance,
   experimental endpoint shapes, Confluence seat enumeration quality, JPD
   seats, org-API UX, quota costs) require credentials. Parsers are tolerant;
   failures degrade streams rather than fabricate.
2. **Confluence savings** are intentionally near-zero: seat status UNKNOWN ⇒
   analysis-only until org enrichment or verified site-permission filtering.
3. **Pricing breadth**: one SOURCED dataset (Jira Standard monthly ≤500 seats +
   min-seat floor). Other products render quote-required chips. Extending
   tables requires sourced band/tier data, not guesswork.
4. **KEEP/UNKNOWN card cap** (500) — counts always reflect full population;
   cards beyond cap are aggregated (documented constant).
5. **Per-item money baseline**: each recommendation prices against the current
   tenant baseline; simultaneous removals crossing band boundaries may differ
   from the naive sum. Boundary crossings are surfaced per item; assumption
   stated in exports/dashboard.
6. **Comment/worklog author signals omitted** in V1 issue sweep (payload
   weight) — weakens evidence toward REVIEW/UNKNOWN only (conservative).
7. **Self-license gating** reads the Forge License API but V1 enforces nothing
   (free ≤10 users is informational; Marketplace handles entitlements).

## 5. Highest-value next actions

For `functional_redteam`: attack AC4 boundary math at band edges with
minimum-floor interactions, the corroboration rule (can two *dependent*
surfaces be gamed?), multi-group dedup, and rounding drift between hero and
cards on PARTIAL scans.

For `security_redteam`: verify ADV-3 (fixture unreachable in prod build),
storage key validation vs Forge KVS reality, resolver context derivation
(installationId availability across module types), log scrubbing coverage, and
that manifest scopes match exercised calls exactly (esp. `read:avatar:jira`
justified via group/member endpoint requirements, `read:jira-work` deviation).

For `release_integrator`: if audits find no BLOCKER/HIGH, set
`release_status=PARITY_READY_AWAITING_CREDENTIALS`, `continue=false`;
next_focus when credentials arrive: register app (`forge register` fills the
manifest id), run authenticated lint/deploy/install, execute the VERIFY-LIVE
checklist in docs/API_FEASIBILITY_ADDENDUM.md A1 and feasibility §9.

## 6. Commands

```
npm test                # full suite (also inside parity container)
npm run typecheck       # tsc strict
npm run lint            # static security/hygiene gates
npm run build           # gates + typecheck
npm run parity:local    # docker-based network-isolated parity gate
ATLAS_DATA_MODE=fixture ATLAS_FIXTURE_VARIANT=default \
  npx tsx src/dev/runFixtureScan.ts   # dev CLI: full pipeline over sample data
```

Fixture variants: default · insufficient_permissions · rate_limit_recovery ·
partial_failure · truncated_pagination · org_enriched · empty_tenant.

— implementation_builder, 2026-08-26
