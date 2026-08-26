# Atlas 24h Factory

Atlas uses the smallest autonomous structure that materially reduces wall-clock time or release risk.

## Control plane

Every OpenCode session is governed by:
1. `ATLAS_MASTER_PROMPT.md` — human-owned constitution;
2. root `AGENTS.md` — common operating standard;
3. `docs/agents/AGENT_CARDS.md` — exact machine-checked role card;
4. workflow-specific internalized handoffs.

The OpenCode wrapper verifies a one-to-one mapping between `.opencode/agents/*.md` and canonical cards and restores protected control-plane files after every agent run. An autonomous product agent therefore cannot silently rewrite its own role, the master prompt, Forge parity rules or CI workflows.

`control-plane-check.sh` machine-checks the invariants that previously caused real failures: no blind factory cron, five-minute watchdog cadence, exact Ox transient signatures, one retrying installer path, valid continuation state, exact agent-card mapping, missing-Forge-app registration handling, and candidate publication only after successful release gates.

## Lanes

Three independent architects run in parallel after the control-plane guard: API feasibility, market/product, security/test. One Builder owns implementation. Two independent red teams attack the same snapshot. One Release Integrator performs the only repair/integration pass.

## Continuity

`state/factory_direction.json` is accepted machine-readable continuation state.

`Atlas Factory Supervisor` runs after every completed main factory cycle and twice per hour as a dead-man fallback. It is fail-closed: if the accepted state is unreadable or invalid, it dispatches nothing. It dispatches another cycle only when:
- no Atlas factory run is active;
- the last factory run succeeded;
- `continue=true`;
- a concrete `next_focus` exists;
- the 24-hour anti-runaway cap has not been reached.

The main product factory has **no direct scheduled cron**. Explicit `workflow_dispatch` and `.factory/KICKOFF` pushes can start it; autonomous continuation belongs only to the state-aware Supervisor. This prevents a release already marked `continue=false` from waking up six hours later and burning another autonomous cycle.

## Ox / runner recovery

`Atlas Ox and Runner Watchdog` runs after every factory completion and every five minutes. It retries only explicit infrastructure failures and never masks deterministic product/test failures.

The in-job OpenCode wrapper retries transient provider/network errors before failing the job. Its signature set includes the actual failures observed in Atlas (`Unexpected server error`, `Upstream request failed`, `Endpoint is unavailable`, `UnknownError`) in addition to HTTP 429/5xx and normal network/runner failures. Exhaustion emits a stable `ATLAS_TRANSIENT_OX_EXHAUSTED` marker.

OpenCode installation also goes through one retrying helper. Exhaustion emits `ATLAS_TRANSIENT_OX_INSTALL_EXHAUSTED`, which the Watchdog recognizes.

The Watchdog caps GitHub-level reruns at three attempts. It will not resurrect an old autonomous scheduled failure when `main` already says `continue=false`; explicit human-triggered runs remain recoverable.

## Deterministic main audit

`Atlas Main Deterministic Audit` is independent of Ox. On relevant pushes to `main` it runs:
- control-plane invariants;
- `npm ci`;
- unit/integration tests;
- typecheck;
- static gates;
- build gate;
- the isolated Forge parity container (Node 24, 512 MB, network disabled).

This gives product truth even when the free Ox provider is unavailable.

## Forge live gate

Until credentials are connected, candidates must pass `docs/FORGE_PARITY_MODE.md` and the Node 24 / 512 MB network-isolated parity container.

Once credentials exist, the final gate requires Forge credentials **and a real `ATLASSIAN_SITE`** before it claims live success. If `manifest.yml` has no registered Forge app id, the gate runs `forge register` using `FORGE_DEVELOPER_SPACE_ID`; it then runs authenticated `forge lint`, development deploy and Jira install. Only after all three succeed does `state/factory_direction.json` advance to `LIVE_DEV_VERIFIED`. Optional Organization API smoke tests remain separate and must not fabricate production support.

A failed Release Integrator can no longer overwrite the canonical `factory/<run>/candidate` branch: that branch is persisted only after the hard host and Forge parity gates succeed.

## Anti-usine-à-gaz rules

- No agent exists merely to supervise another.
- Research ends in implementation constraints, not essays.
- Builder owns one coherent codebase.
- Auditors cannot mutate the candidate they judge.
- One Integrator fixes/tests/chooses the candidate.
- Control-plane evolution is human-owned.
- A new autonomous cycle must have a concrete product-relevant next focus.
