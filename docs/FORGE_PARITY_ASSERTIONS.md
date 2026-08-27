# FORGE PARITY ASSERTIONS

This file is printed by `.github/scripts/forge-parity-check.sh` on every run.
Every statement below describes what the deterministic parity gate actually proves today. Authenticated Forge behavior is deliberately kept separate and is never inferred from this file.

## Runtime and manifest

- [x] Real Forge `manifest.yml` targeting `app.runtime.name: nodejs24.x` with 512 MB memory.
- [x] Modern UI Kit admin page wiring uses a `resource`, `render: native`, and a backend resolver.
- [x] The manifest declares exactly two Forge functions: the resolver and the scheduled scan-chunk worker.
- [x] The scan worker has `timeoutSeconds: 900` and exactly one `scheduledTrigger` with `interval: fiveMinute`.
- [x] `app.licensing.enabled: true` is present for self-license detection.
- [x] Scope budget equals the verified nine-scope read-only allowlist. Zero write scopes, zero admin scopes, no egress remotes.
- [x] The pre-registration all-zero app ARI is accepted only as the explicit sentinel; the authenticated live gate must replace and persist it through `forge register` before deploy.
- [x] Deterministic parity does **not** claim authenticated `forge lint`. Authenticated lint belongs to the authenticated CI/live gate when Forge credentials and a registered app exist.

## One pipeline, two transports

- [x] `ScanService` and the pure downstream pipeline consume the Atlas-owned `AtlassianGateway` interface.
- [x] `ForgeAtlassianGateway` and `FixtureAtlassianGateway` are the production and deterministic transports.
- [x] Both pass through shared adapters; the parity-equivalence test proves equivalent final reports for equivalent evidence.
- [x] No separate demo scanner or demo business logic exists in normalization, evidence, risk, finance, recommendation, or UI-model code.
- [x] Production entrypoints cannot import the fixture transport or development harness.

## Honest-data semantics

- [x] Partial scans preserve per-stream OK/DEGRADED/FAILED telemetry and remain PARTIAL until a complete scan succeeds.
- [x] Missing or malformed activity evidence forces UNKNOWN and cannot produce SAFE NOW.
- [x] 401/403 failures degrade the affected stream without synthesized zero activity.
- [x] Retry-After is honored as a floor; bounded exponential backoff remains tested.
- [x] Pagination truncation or unverifiable continuation produces PARTIAL rather than a fabricated COMPLETE scan.
- [x] Optional/experimental license evidence can be absent without being interpreted as zero.

## Money discipline

- [x] Progressive-band pricing has golden regression vectors.
- [x] Savings are scenario deltas with boundary/timing assumptions surfaced.
- [x] Integer-cent arithmetic and aggregate flooring prevent displayed subitems from exceeding the hero total.
- [x] Unsupported price surfaces remain `PRICING_UNKNOWN` / quote-required rather than guessed.

## Fixture visibility

- [x] Fixture runs stamp `dataMode=FIXTURE` through reports, recommendations, dashboard models, and exports.
- [x] Fixture identities and tenant labels are visibly synthetic and cannot be mistaken for a live Atlassian scan.

## Container guarantees

- [x] Parity tests run inside Node 24 with a 512 MB process/container budget, 512 MB `/tmp`, and `--network=none`.
- [x] The 60k-user × 120k-hit stress derivation completes under the Forge memory budget.

## Boundary of proof

`FORGE_PARITY_GATE=PASS` means the deterministic Forge-shaped product is internally consistent under these constraints. It does **not** mean the app has been authenticated, deployed, installed, or exercised against a real Jira tenant. Those claims require the live gate and the real-environment verification checklist.
