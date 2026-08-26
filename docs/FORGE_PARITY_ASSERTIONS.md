# FORGE PARITY ASSERTIONS

This file is printed by `.github/scripts/forge-parity-check.sh` on every run.
Each assertion below is enforced by automated checks in this repository.

## Runtime and manifest

- [x] Real Forge `manifest.yml` (no proprietary substitute) targeting
      `runtime.name: nodejs24.x`, memory 512 MB — checked by parity script grep
      and `scripts/static-gates.mjs`.
- [x] Manifest modules: one `jira:adminPage` (useAsConfig + useAsGetStarted),
      three functions, exactly one scheduled trigger (`fiveMinutes`) within the
      five-module limit.
- [x] `licensing.enabled: true` for self-license detection (feasibility row 14).
- [x] Scope budget equals the verified allowlist exactly (GATE-2 / SEC-2a /
      BLK-5). Zero write scopes. Zero admin scopes. No egress remotes.
- [x] Latest `@forge/cli` installed in the parity image; CLI drift visible.

## One pipeline, two transports (adapter rule)

- [x] Single scanner: `ScanService` + pure pipeline consume ONLY the
      Atlas-owned `AtlassianGateway` interface.
- [x] `ForgeAtlassianGateway` (production, lazy `@forge/api`) and
      `FixtureAtlassianGateway` (deterministic) are the only two conformers.
- [x] Both parse responses through shared adapters; AC10 equivalence test
      proves byte-identical final reports from both transports.
- [x] No demo scanner, no demo business logic, no mode conditionals in
      normalization/evidence/risk/finance/recommendation/UI-model modules
      (AC10 static check).
- [x] Engine tree contains no sample-data literals (FIX-6/GATE-4); production
      entrypoints cannot import the sample transport or dev harness (ADV-3).

## Honest-data semantics

- [x] Partial scans: per-stream OK/DEGRADED/FAILED telemetry travels into the
      report; PARTIAL status persists until a complete scan succeeds (BLK-4,
      ERR-1, parity rules 8–9).
- [x] Missing/malformed activity fields force UNKNOWN evidence and can never
      produce SAFE NOW (ERR-2/ERR-6, BLK-1, parity rule 9) — tested.
- [x] 401/403 degrade the affected stream with surfaced reasons; no synthesized
      zeros (ERR-3) — tested.
- [x] Retry-After honored as floor; exponential backoff with seeded jitter;
      ceiling 4 attempts then failed-not-fatal (feasibility §5) — tested.
- [x] Pagination honors returned sizes incl. mid-loop size change; truncated
      continuation aborts to PARTIAL (ERR-7) — tested.
- [x] Experimental license-metrics endpoints tolerated absent (UNKNOWN, never
      zero) — tested via empty-tenant variant.

## Money discipline

- [x] Progressive-band golden case ($3,175.00/month @ 450 seats) is an
      automated test (AC4).
- [x] Scenario deltas only; boundary crossings detected and called out;
      MQB timing labels; annual tiers realize at renewal (AC5) — tested.
- [x] Exact integer-cent arithmetic; aggregates exact-sum-then-round-down-once;
      per-item display floors never exceed hero (FP-S3/S4) — tested.
- [x] Only the golden-anchored price dataset is SOURCED; everything else is
      PRICING_UNKNOWN → quote-required (BLK-7 protection, see
      docs/API_FEASIBILITY_ADDENDUM.md A5).

## Fixture visibility

- [x] Fixture runs stamp `dataMode=FIXTURE` on report, recommendations,
      dashboard VM and exports; unmissable DEMO banner text rendered from the
      provenance field (FIX-2/FIX-3) — tested.
- [x] Fixture identities use `fixture-*` account ids and tenant
      `ATLAS PARITY DEMO`; `[FIXTURE]` log prefix applied by the dev harness.

## Container guarantees

- [x] Tests execute inside Node 24, 512 MB memory, 512 MB `/tmp`,
      `--network=none` (this script). No runtime dependence on public internet.
- [x] 60k-user × 120k-hit stress derivation completes well under the memory
      budget (ADV-5/GATE-8) — tested.
