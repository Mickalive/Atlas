# ATLAS — AGENT OPERATING STANDARD

`ATLAS_MASTER_PROMPT.md` is the human-owned constitution and has highest precedence.

The workflow uses the seven original Atlas roles: `market_product_architect`, `api_architect`, `security_test_architect`, `implementation_builder`, `functional_redteam`, `security_redteam`, `release_integrator`.

Before substantive work, each role reads the master prompt, `PRODUCT_CONTRACT.md`, its exact card in `docs/agents/AGENT_CARDS.md`, `docs/FORGE_PARITY_MODE.md`, `docs/RELEASE_STATUS.md`, `state/factory_direction.json`, and the canonical architecture/audit inputs relevant to its mission.

## Shared product truth

Never invent Atlassian API behavior, Forge capabilities, credentials, live data, pricing certainty or successful scans. Preserve UNKNOWN and partial states. Fixture data must be unmistakably non-live and feed the same downstream Atlas logic as production adapters. False-positive removal recommendations are the worst failure.

## Parallel role separation

- `market_product_architect`, `api_architect`, and `security_test_architect` run independently and in parallel from the same committed `main`. Each may modify only its canonical architecture document(s).
- `implementation_builder` receives all three architecture patches, builds the exact candidate, and adds regression coverage.
- `functional_redteam` and `security_redteam` receive the same exact candidate and run independently/in parallel. Their only durable writes are `audit/FUNCTIONAL.md` and `audit/SECURITY.md`. They do not repair the candidate they judge.
- `release_integrator` receives the candidate plus both fresh audits, repairs material findings, preserves the audits unchanged, runs final release gates, and updates release truth.

## Shared restrictions

No role may modify `ATLAS_MASTER_PROMPT.md`, `AGENTS.md`, `PRODUCT_CONTRACT.md`, `docs/FORGE_PARITY_MODE.md`, `docs/agents/AGENT_CARDS.md`, `.opencode/agents/`, `.github/workflows/` or `.github/scripts/`. The OpenCode wrapper restores those protected paths after each agent call.

Do not ask interactive questions during autonomous runs. Do not weaken tests or gates. Do not expose secrets. Do not add external LLM/SaaS dependencies. Do not widen V1 scope merely to create activity. Do not create Git branches, candidate/continuation branches, additional workflows, supervisors or separate watchdog workflows.

## Workflow discipline

The single `.github/workflows/atlas-factory.yml` owns the whole DAG and resilience model. Inter-lane handoff uses ephemeral run artifacts/patches only. `main` is the only persistent product truth and is written only by the release integrator after both audits and all deterministic gates pass.

If a lane/provider/gate fails, nothing is promoted. The same workflow heartbeat retries later from the last good `main`.

`MARKETPLACE_READY` is the only final stop state. Every other state remains unfinished and must preserve an honest next action or blocker.
