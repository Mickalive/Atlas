# Atlas 24h Factory

Atlas uses the smallest autonomous structure that materially reduces wall-clock time or release risk.

## Control plane

Every OpenCode session is governed by:
1. `ATLAS_MASTER_PROMPT.md` — human-owned constitution;
2. root `AGENTS.md` — common operating standard;
3. `docs/agents/AGENT_CARDS.md` — exact machine-checked role card;
4. workflow-specific mounted handoffs.

The OpenCode wrapper verifies a one-to-one mapping between `.opencode/agents/*.md` and canonical cards and restores protected control-plane files after every agent run. An autonomous product agent therefore cannot silently rewrite its own role, the master prompt, Forge parity rules or CI workflows.

## Lanes

Three independent architects run in parallel: API feasibility, market/product, security/test. One Builder owns implementation. Two independent red teams attack the same snapshot. One Release Integrator performs the only repair/integration pass.

## Continuity

`state/factory_direction.json` is accepted machine-readable continuation state.

`Atlas Factory Supervisor` runs after every completed main factory cycle and twice per hour as a dead-man fallback. It dispatches another cycle only when:
- no Atlas factory run is active;
- the last factory run succeeded;
- `continue=true`;
- a concrete `next_focus` exists;
- the 24-hour anti-runaway cap has not been reached.

`Atlas Ox and Runner Watchdog` also runs after failures and twice per hour. It reruns failed jobs only when logs contain defensible transient OpenCode/network/runner signatures. It never hides a deterministic product/test failure by blind repetition.

The main factory retains a slower six-hour scheduled fallback and concurrency locking.

## Forge parity

Until credentials are connected, candidates must pass `docs/FORGE_PARITY_MODE.md` and the Node 24 / 512 MB network-isolated parity container. Once credentials exist, the final gate adds authenticated Forge lint/deploy/install and optional organization API smoke tests without changing Atlas architecture.

## Anti-usine-à-gaz rules

- No agent exists merely to supervise another.
- Research ends in implementation constraints, not essays.
- Builder owns one coherent codebase.
- Auditors cannot mutate the candidate they judge.
- One Integrator fixes/tests/chooses the candidate.
- Control-plane evolution is human-owned.
- A new cycle must have a concrete product-relevant next focus.
