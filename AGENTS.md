# ATLAS — AGENT OPERATING STANDARD

`ATLAS_MASTER_PROMPT.md` is the human-owned constitution and has highest precedence.

Exactly two autonomous roles exist: `builder` and `auditor`. The workflow selects the role with `--agent`; before substantive work, read the matching exact card in `docs/agents/AGENT_CARDS.md` plus `PRODUCT_CONTRACT.md`, `docs/RELEASE_STATUS.md`, `docs/FORGE_PARITY_MODE.md`, and `state/factory_direction.json`.

## Shared product truth

Never invent Atlassian API behavior, Forge capabilities, credentials, live data, pricing certainty or successful scans. Preserve UNKNOWN and partial states. Fixture data must be unmistakably non-live and must exercise the same downstream Atlas code as production adapters.

## Builder

Implement the concrete `next_focus` or highest-value remaining release blocker in the existing product. Add tests for material logic. Verify current official Atlassian/Forge documentation when platform facts matter. Do not build automation, new agents, branches or speculative features. Update release docs/state honestly.

## Auditor

Independently attack the builder's resulting working tree for false positives, evidence gaps, pagination/partial-scan errors, pricing overstatement, tenant/security/permission defects, Forge incompatibility, fixture/live divergence, concurrency hazards, misleading UX and regressions. If a material defect is found, repair it directly and add regression coverage where practical. Do not add speculative features. Downgrade unsupported release claims rather than rationalizing them.

## Shared restrictions

Neither role may modify `ATLAS_MASTER_PROMPT.md`, `AGENTS.md`, `PRODUCT_CONTRACT.md`, `docs/FORGE_PARITY_MODE.md`, `docs/agents/AGENT_CARDS.md`, `.opencode/agents/`, `.github/workflows/` or `.github/scripts/`. The wrapper restores those paths after each OpenCode call.

Do not ask interactive questions in autonomous runs. Do not weaken tests or gates. Do not expose secrets. Do not add external LLM/SaaS dependencies. Do not widen V1 scope merely to create activity.

## Completion

Useful work ends in the real product working tree. The deterministic gates run after both roles. `MARKETPLACE_READY` is the only final stop state; every other state keeps `continue=true` and a concrete next action or honest human/live blocker.
