# ATLAS — CURRENT RELEASE STATUS

Updated: 2026-08-27

Status: **PARITY_READY_AWAITING_CREDENTIALS**

Atlas is a Forge-shaped, read-only Atlassian Renewal FinOps V1 whose primary output is **ESTIMATED ANNUAL SAVINGS**. Product truth remains unchanged: SAFE NOW / REVIEW / KEEP / UNKNOWN, missing evidence is UNKNOWN, false-positive removal recommendations are the worst failure, partial scans stay visibly partial, and unsupported pricing is never guessed.

## Current deterministic product proof

The most recent complete deterministic product validation is GitHub Actions run `33067877466` at commit `7c74838f5580f8fd2c9c141c1add3113304c5e3d`:

- `npm ci`: PASS;
- unit/integration suite: **127/127 tests, 15/15 files PASS**;
- backend TypeScript check: PASS;
- UI Kit/frontend TypeScript check: PASS;
- product/static/security/Marketplace gates: PASS;
- high/critical dependency advisory gate: PASS;
- build gate: PASS;
- isolated Forge parity gate: **FORGE_PARITY_GATE=PASS** under Node 24, 512 MB and `--network=none`.

Those product tests/gates were not weakened during the factory rebuild. The dependency tree reports eight moderate advisories through Atlaskit/Forge dependencies; the high/critical gate is green. `npm audit fix --force` remains deliberately avoided because npm proposes breaking dependency changes.

## Product correctness retained

The regression suite covers false-positive removal classification, missing/malformed evidence → UNKNOWN, 401/403 and repeated 5xx degradation, 429/Retry-After recovery, pagination truncation, org-vs-product activity recency, partial-drain safety, pricing golden vectors/band boundaries/exact cents, totals/card-cap accounting, export hygiene/formula injection, tenant isolation, log secret scrubbing, scan lease/concurrency best effort, fixture/live-shaped transport equivalence, and 60k users × 120k activity hits under the 512 MB Forge budget.

## Forge parity boundary

Current manifest shape:

- `app.runtime.name: nodejs24.x`;
- 512 MB runtime memory;
- `app.licensing.enabled: true`;
- modern UI Kit Jira admin page using `resource`, `render: native`, and resolver wiring;
- two Forge functions: resolver + scheduled scan-chunk worker;
- scheduled worker `timeoutSeconds: 900`, interval `fiveMinute`;
- nine verified read-only scopes;
- zero write scopes, zero admin scopes, no egress remotes;
- all-zero app ARI only as the explicit pre-registration sentinel.

Offline parity does not claim authenticated Forge behavior. The live gate must register the app if needed, persist the real ARI, run authenticated `forge lint`, deploy to development and install on the target Jira site before any live claim.

## Real-environment checklist still required

Once repository secrets and a target site exist, retire these UNKNOWNs with live evidence:

1. authenticated Forge registration, lint, development deploy and Jira install;
2. actual acceptance of required Jira/Confluence scopes under installed-app identity;
3. live pagination/continuation shapes;
4. tenant-context consistency between resolver and scheduled-trigger contexts;
5. resolver accessibility/authorization for non-admin users;
6. Forge KVS behavior under concurrent lease/checkpoint access;
7. end-to-end real tenant scan with manual spot checks of classifications and savings;
8. final Marketplace/security/privacy packaging.

## Current factory architecture

The automation was rebuilt to preserve the original specialist team while removing orchestration layers.

There is exactly **one** workflow: `.github/workflows/atlas-factory.yml`, scheduled every five minutes and serialized with one concurrency group.

When product work is required, it runs the original seven roles sequentially on the same working tree:

`market_product_architect → api_architect → security_test_architect → implementation_builder → functional_redteam → security_redteam → release_integrator → deterministic gates → commit`

The red teams remain genuinely independent: they write fresh audit reports and do not repair the product they judge. `release_integrator` consumes both reports and performs repairs. No role branch, candidate branch, continuation branch, Supervisor, separate Watchdog or secondary CI workflow is part of the current architecture.

Only three technical helpers remain: resilient OpenCode installation, one OpenCode-call retry/inactivity wrapper, and the Forge parity script. The five-minute schedule itself is the recovery heartbeat.

The new single-workflow topology must not be called runtime-verified until a run using the rebuilt YAML is actually observed. Its repository structure and agent registry are currently consistent: one workflow and seven exact canonical agent definitions/cards.

## State behavior

- `BUILDING` / `LIVE_DEV_VERIFIED`: run the complete seven-role cycle and gates.
- `PARITY_READY_AWAITING_CREDENTIALS`: without Forge credentials/site, make no Ox call and re-check on the next heartbeat; with credentials, execute the authenticated Forge gate.
- `BLOCKED_HUMAN`: do not invent human evidence; re-check on the heartbeat.
- `MARKETPLACE_READY`: final stop.

## Honest residuals

- **Not Marketplace-ready:** authenticated Forge/live Jira proof is missing.
- Eight moderate dependency advisories remain; no high/critical advisory currently fails the release gate.
- The repository is public and branch protection has not been certified as active.
- The best-effort KVS scan lease cannot be called race-proof until live Forge concurrency semantics are observed.
- Per-item pricing can conservatively understate simultaneous removals that cross pricing-band boundaries; it must not be represented as exact billing truth.
- A stale historical `factory/continuation` branch still exists at GitHub-ref level; current automation neither reads nor writes it. It should be deleted when a branch-delete capability is available. It is not part of product state or execution.

## Machine direction

`state/factory_direction.json` is `PARITY_READY_AWAITING_CREDENTIALS` with `continue=true`. The concrete next action is authenticated Forge/live verification when credentials become available; until then the single factory should wake on schedule, make no Ox call, and exit cleanly.
