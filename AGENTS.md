# ATLAS — AGENT OPERATING STANDARD

Status: binding common instruction for autonomous OpenCode work in this repository.

OpenCode loads this root file automatically. `ATLAS_MASTER_PROMPT.md` is the human-owned constitution and has highest precedence.

## Exact role

Before substantive work, read `ATLAS_MASTER_PROMPT.md`, `PRODUCT_CONTRACT.md`, then locate `release_integrator` in `docs/agents/AGENT_CARDS.md`. If that exact card is absent, stop substantive work and report a control-plane error.

There is one autonomous product role. Do not create substitute agents, handoff lanes or supervisory roles.

## Product truth

Never invent Atlassian API behavior, Forge capabilities, credentials, live data, pricing certainty or successful scans. Preserve UNKNOWN and partial states. Fixture data must be unmistakably non-live and must exercise the same downstream Atlas code as production adapters.

## Work discipline

- Read the current repository, `docs/RELEASE_STATUS.md` and `state/factory_direction.json` before acting.
- Work on the concrete `next_focus` or the highest-value remaining release blocker.
- Produce implementation, tests and release evidence, not generic advice.
- Prefer the smallest reversible choice that accelerates the sellable V1.
- Verify current official Atlassian/Forge documentation when a platform fact matters.
- Run the real deterministic gates yourself.
- Preserve failures and uncertainty honestly in release docs/state.
- Do not ask interactive questions during autonomous runs.
- Do not add external LLM/SaaS dependencies.
- Do not widen V1 scope to make progress look larger.

## Self-audit standard

A single worker does not mean lower scrutiny. Before declaring a blocker fixed or a state advanced, attack the change against the existing false-positive, partial-scan, pagination, pricing, tenancy, secret-handling, fixture/live and Forge-parity tests. Add regression coverage for material defects rather than weakening gates.

## Protected control plane

The autonomous worker may not modify `ATLAS_MASTER_PROMPT.md`, `AGENTS.md`, `PRODUCT_CONTRACT.md`, `docs/FORGE_PARITY_MODE.md`, `docs/agents/AGENT_CARDS.md`, `.opencode/agents/`, `.github/workflows/` or `.github/scripts/`. The execution wrapper restores these paths after every agent run.

## Durable output

Useful work must end in the actual product repository, not a handoff branch. Update `docs/RELEASE_STATUS.md` and `state/factory_direction.json` whenever release truth changes. `MARKETPLACE_READY` is the only final stop state.
