# ATLAS — CURRENT RELEASE STATUS

Updated: 2026-08-27

Status: **PARITY_READY_AWAITING_CREDENTIALS**

Atlas is a Forge-shaped, read-only Atlassian Renewal FinOps V1 whose primary output is **ESTIMATED ANNUAL SAVINGS**. The product contract remains unchanged: SAFE NOW / REVIEW / KEEP / UNKNOWN, missing evidence is UNKNOWN, false-positive removal recommendations are the worst failure, partial scans stay visibly partial, and unsupported pricing is never guessed.

## Current deterministic proof

The rebuilt control plane was validated on GitHub Actions run `33067877466` at commit `7c74838f5580f8fd2c9c141c1add3113304c5e3d`:

- simple control-plane gate: PASS;
- `npm ci`: PASS;
- unit/integration suite: **127/127 tests, 15/15 files PASS**;
- backend TypeScript check: PASS;
- UI Kit/frontend TypeScript check: PASS;
- product/static/security/Marketplace gates: PASS;
- high/critical dependency advisory gate: PASS;
- build gate: PASS;
- isolated Forge parity gate: **FORGE_PARITY_GATE=PASS** under Node 24, 512 MB and `--network=none`.

The dependency tree currently reports eight **moderate** advisories through Atlaskit/Forge dependencies. The high/critical gate is green. `npm audit fix --force` is deliberately not applied because npm proposes a breaking dependency change; this remains a dependency-maintenance item, not a reason to weaken or destabilize the release candidate.

## Product correctness retained

The existing regression suite covers, among other things:

- false-positive removal classification;
- missing/malformed evidence → UNKNOWN;
- 401/403 and repeated 5xx degraded scans;
- 429 recovery and Retry-After handling;
- pagination truncation and unverifiable continuation;
- org-wide versus product-specific activity recency;
- partial-drain behavior that prevents fake SAFE NOW savings;
- pricing golden vectors, band boundaries and exact-cent aggregation;
- total-population versus card-cap accounting;
- CSV/export hygiene and formula-injection neutralization;
- tenant isolation and log secret scrubbing;
- scan leases/concurrency best-effort protection;
- fixture/live-shaped transport equivalence;
- 60k users × 120k activity hits inside the 512 MB Forge budget.

Historical defect details remain recoverable in git history and the audit documents; this status file records current release truth rather than preserving obsolete factory topology.

## Forge parity boundary

Deterministic parity proves the actual repository manifest and product architecture are internally consistent with the intended Forge deployment shape. It does **not** claim authenticated Forge behavior.

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

Authenticated `forge lint` is intentionally separated from offline parity. The authenticated CI/live gate must replace the sentinel with the real app ARI via `forge register`, persist it, lint, deploy to development and install on the target Jira site before any live claim is made.

## Real-environment checklist still required

Once the repository secrets and target site exist, retire these UNKNOWNs with sourced/live evidence:

1. authenticated Forge registration, lint, development deploy and Jira install;
2. actual acceptance of every required Jira/Confluence scope under installed-app identity;
3. live pagination and continuation shapes for the production endpoints;
4. tenant-context derivation consistency between resolver and scheduled-trigger contexts;
5. direct resolver accessibility by non-admin users and explicit server-side permission enforcement if needed;
6. Forge KVS behavior under concurrent lease/checkpoint access;
7. end-to-end real tenant scan with manual spot checks against classifications and savings;
8. final Marketplace/security/privacy packaging.

## Control plane after the 2026-08-27 reset

The previous multi-agent factory topology has been retired. Atlas now has exactly:

- one scheduled product workflow: `.github/workflows/atlas-factory.yml`;
- one deterministic CI workflow: `.github/workflows/atlas-main-ci.yml`;
- one autonomous product role: `release_integrator`.

The Factory is the single five-minute heartbeat. It is serialized and does not cancel an active cycle. Ox/provider/network failures receive bounded internal retries. A silent Ox call is killed after five minutes of inactivity and treated as transient. If retries are exhausted, the next scheduled Factory cycle is the retry — there is no Supervisor or separate Watchdog racing it.

When state is `PARITY_READY_AWAITING_CREDENTIALS` and Forge credentials/site are missing, the Factory exits cleanly **without calling Ox**. This is deliberate: the deterministic product is already gate-clean, and manufacturing more autonomous work merely to keep the factory busy would be fake progress.

## Honest residuals

- **Not Marketplace-ready yet:** authenticated Forge/live Jira proof is still missing.
- Eight moderate dependency advisories remain; no high/critical advisory currently fails the release gate.
- The repository is currently public and branch protection has not been certified as active; this is a repository-security/configuration residual separate from product correctness.
- The best-effort KVS scan lease cannot be called race-proof until live Forge concurrency semantics are observed.
- Per-item pricing can conservatively understate simultaneous removals that cross pricing-band boundaries; it must not be represented as exact billing truth.

## Machine direction

`state/factory_direction.json` remains `PARITY_READY_AWAITING_CREDENTIALS` with `continue=true` because `MARKETPLACE_READY` is the only final stop state. The concrete next action is the authenticated Forge/live verification path when credentials become available; until then the factory should keep deterministic CI green and make no Ox call.
