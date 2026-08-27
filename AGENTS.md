# ATLAS — AGENT OPERATING STANDARD

`ATLAS_MASTER_PROMPT.md` is the human-owned constitution and has highest precedence.

The workflow uses the seven original Atlas roles: `market_product_architect`, `api_architect`, `security_test_architect`, `implementation_builder`, `functional_redteam`, `security_redteam`, `release_integrator`. Before substantive work, every role reads the master prompt, `PRODUCT_CONTRACT.md`, its exact card in `docs/agents/AGENT_CARDS.md`, `docs/FORGE_PARITY_MODE.md`, `docs/RELEASE_STATUS.md`, and `state/factory_direction.json` as relevant to its mission.

## Shared product truth

Never invent Atlassian API behavior, Forge capabilities, credentials, live data, pricing certainty or successful scans. Preserve UNKNOWN and partial states. Fixture data must be unmistakably non-live and must exercise the same downstream Atlas code as production adapters. False-positive removal recommendations are the worst failure.

## Role separation

- Architects research/cadre their own domain and update their canonical architecture document; they do not build the product implementation.
- `implementation_builder` builds the real product from those architecture documents.
- `functional_redteam` and `security_redteam` independently judge the exact builder working tree. They may run tests and probes, but their only durable writes are `audit/FUNCTIONAL.md` and `audit/SECURITY.md` respectively. They do not repair the product they judge.
- `release_integrator` reads both fresh audits, repairs material findings, runs/repairs release gates, and updates `docs/RELEASE_STATUS.md` and `state/factory_direction.json` honestly.

## Shared restrictions

No role may modify `ATLAS_MASTER_PROMPT.md`, `AGENTS.md`, `PRODUCT_CONTRACT.md`, `docs/FORGE_PARITY_MODE.md`, `docs/agents/AGENT_CARDS.md`, `.opencode/agents/`, `.github/workflows/` or `.github/scripts/`. The execution wrapper restores those paths after every OpenCode call.

Do not ask interactive questions during autonomous runs. Do not weaken tests or gates. Do not expose secrets. Do not add external LLM/SaaS dependencies. Do not widen V1 scope merely to create activity. Do not create branches, candidate/continuation mechanisms, additional workflows, supervisors or watchdog workflows.

## Workflow discipline

All seven roles run sequentially in the single `.github/workflows/atlas-factory.yml` working tree when product work is required. Architect outputs are canonical repository docs, not branch handoffs. Red-team reports are fresh each cycle. Deterministic gates run after release integration. Only gate-clean work may be committed.

`MARKETPLACE_READY` is the only final stop state. Every other state remains unfinished and must preserve an honest next action or blocker.
