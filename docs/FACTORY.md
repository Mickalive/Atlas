# Atlas 24h Factory

Atlas uses the smallest autonomous structure that materially reduces wall-clock time or release risk.

## Control plane

Every OpenCode session is governed by:
1. `ATLAS_MASTER_PROMPT.md` — human-owned constitution;
2. root `AGENTS.md` — common operating standard;
3. `docs/agents/AGENT_CARDS.md` — exact machine-checked role card;
4. workflow-specific internalized handoffs.

The OpenCode wrapper verifies a one-to-one mapping between `.opencode/agents/*.md` and canonical cards and restores protected control-plane files after every agent run. An autonomous product agent therefore cannot silently rewrite its own role, the master prompt, Forge parity rules or CI workflows.

Two independent deterministic checks protect the orchestration layer: `.github/scripts/control-plane-check.sh` validates shell-level continuity invariants before every factory cycle, and `scripts/control-workflow-gates.mjs` parses the GitHub workflow YAML and checks the non-stopping contract as part of normal product lint/build.

## Lanes

Three independent architects run in parallel after the control-plane guard: API feasibility, market/product, security/test. One Builder owns implementation. Two independent red teams attack the same snapshot. One Release Integrator performs the only repair/integration pass.

## Continuity: Marketplace ready or keep moving

`state/factory_direction.json` is the accepted machine-readable product state. `MARKETPLACE_READY` is the **only** autonomous stop state.

For every other state — `BUILDING`, `PARITY_READY_AWAITING_CREDENTIALS`, `LIVE_DEV_VERIFIED`, or `BLOCKED_HUMAN` — Atlas is unfinished and must keep `continue=true` with a concrete `next_focus`.

`Atlas Factory Continuity Supervisor` runs after every completed product-factory cycle and every five minutes. Its job is not to decide whether Atlas deserves another cycle; unfinished Atlas always does. It checks for an already-active factory, self-heals missing/corrupt/prematurely stopped continuation state, gives the watchdog one short local-recovery window after a failure, and otherwise dispatches a fresh cycle from `main`.

There is no daily cycle cap. Exhausting a local retry budget is not a global stop condition.

The main product factory itself has no scheduled cron. This avoids duplicate long-running factories while leaving continuity to the dedicated five-minute supervisor.

## Ox / runner recovery

`Atlas Ox and Runner Watchdog` runs after factory completion and every five minutes. The in-job wrapper first retries transient provider/network failures. Its signature set includes the actual Atlas failures (`Unexpected server error`, `Upstream request failed`, `Endpoint is unavailable`, `UnknownError`) plus HTTP 429/5xx and normal network/runner failures. OpenCode installation has its own retry helper as well.

A single failed GitHub run is retried only a bounded number of times so deterministic defects are not hidden forever. When those local attempts are exhausted, continuity moves to a **fresh factory cycle**, not to a stopped product. Deterministic test/product failures are repaired by a fresh cycle rather than blindly replayed forever.

## Deterministic main audit

`Atlas Main Deterministic Audit` is independent of Ox. On relevant pushes to `main` it runs:
- parsed control-plane/workflow invariants;
- `npm ci`;
- 127+ unit/integration and false-positive tests;
- backend TypeScript typecheck;
- UI Kit JSX typecheck;
- static Forge/security gates;
- `npm audit --audit-level=high` (moderate advisories remain visible; high/critical fail);
- build gate;
- the isolated Forge parity container (Node 24, 512 MB, network disabled).

This gives product truth even when the free Ox provider is unavailable.

## Forge parity and authenticated validation

Current Forge CLI releases require an authenticated Forge identity for `forge lint`. The network-isolated parity container therefore validates deterministic local invariants only and does **not** pretend an unauthenticated CLI lint is possible.

When `FORGE_EMAIL` and `FORGE_API_TOKEN` exist and the app is registered, main CI runs authenticated `forge lint`. The product factory live gate additionally owns registration of an unregistered app via `FORGE_DEVELOPER_SPACE_ID`, authenticated lint, development deploy, and Jira installation on `ATLASSIAN_SITE`.

Missing live credentials are a blocker for live verification, not permission to stop offline hardening. The supervisor keeps Atlas moving and re-checking that blocker every cycle.

## Release safety

A failed Release Integrator cannot overwrite the canonical candidate branch: `factory/<run>/candidate` is persisted only after hard host/parity gates succeed.

`MARKETPLACE_READY` is valid only after live verification, no unresolved release blocker, and completion of release/security/privacy/Marketplace packaging. Only then may `continue=false` stop the autonomous chain.

## Anti-usine-à-gaz rules

- No agent exists merely to supervise another.
- Research ends in implementation constraints, not essays.
- Builder owns one coherent codebase.
- Auditors cannot mutate the candidate they judge.
- One Integrator fixes/tests/chooses the candidate.
- Control-plane evolution is human-owned.
- Every unfinished cycle must have a concrete product-relevant next focus.
