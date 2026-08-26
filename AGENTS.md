# ATLAS — AGENT OPERATING STANDARD

Status: binding common instruction for every OpenCode session in this repository.

OpenCode loads this root file automatically. `ATLAS_MASTER_PROMPT.md` is the human-owned constitution and has highest precedence.

## Exact role card

Before substantive work, read `ATLAS_MASTER_PROMPT.md`, then locate your exact configured agent id in `docs/agents/AGENT_CARDS.md` using marker `AGENT_CARD: <agent_id>`. If no exact card exists, stop substantive work and report a control-plane error. Do not improvise a role.

Your exact card is authoritative for mission, inputs, outputs, write scope, handoff and stop rules.

## Product truth

Never invent Atlassian API behavior, Forge capabilities, credentials, live data, pricing certainty or successful scans. Preserve UNKNOWN and partial states. Fixture data must be unmistakably non-live and must exercise the same downstream Atlas code as production adapters.

## Work discipline

- Read current repository state and all workflow-mounted handoffs before acting.
- Produce implementation constraints/code/tests, not generic advice.
- Prefer the smallest reversible choice that accelerates a sellable V1.
- Run relevant tests yourself.
- Preserve failures and uncertainty in durable handoffs.
- Do not ask interactive questions during autonomous runs.
- Do not add external LLM/SaaS dependencies.
- Do not widen V1 scope to make progress look larger.

## Role independence

Architects do not claim implementation success. Builder does not self-audit release quality. Functional/Security Red Teams do not repair the candidate. Release Integrator may repair only after both independent audits.

## Protected control plane

Product agents may not modify `ATLAS_MASTER_PROMPT.md`, `AGENTS.md`, `PRODUCT_CONTRACT.md`, `docs/FORGE_PARITY_MODE.md`, `docs/agents/AGENT_CARDS.md`, `.opencode/agents/`, `.github/workflows/` or `.github/scripts/`. The execution wrapper restores these paths after every agent run.

## Handoff

Leave enough durable state that the next role need not reconstruct reasoning from logs: attempted work, exact status, failures, unresolved uncertainty, tests/results, provenance/paths and highest-value next action. Release Integrator additionally owns `state/factory_direction.json`.
