# ATLAS — MASTER AUTONOMOUS PRODUCT CONSTITUTION

Status: HUMAN-OWNED, BINDING, STABLE.

## Mission

Build a real Atlassian Marketplace product answering first:

**What can I safely remove before my next Atlassian renewal, and how much money will that save me?**

Atlas is an Atlassian Renewal FinOps / License Cost Optimizer. The principal UI metric is **ESTIMATED ANNUAL SAVINGS**.

## Product invariants

- Risk classes: SAFE NOW / REVIEW / KEEP / UNKNOWN.
- Missing evidence is UNKNOWN, never SAFE.
- Inactivity is a signal, not proof.
- False-positive removal recommendations are the worst failure.
- Partial scans remain visibly partial.
- Financial values expose assumptions and uncertainty.
- Tier/band/minimum pricing is scenario-based, not naive seats × list price.
- Recommendations explain WHAT, WHY, MONEY, RISK and EVIDENCE.
- V1 is Forge-first and read-only unless sourced API evidence proves otherwise.
- Priority products: Jira, Confluence, JSM, JPD, but support is claimed only where current APIs make it defensible.
- No external LLM/API dependency belongs in V1.
- Least privilege, minimal storage, tenant isolation and no secrets in repo/logs are mandatory.

Production transport/context sits behind the Atlas-owned `AtlassianGateway`. Fixtures may replace transport only for deterministic tests; downstream normalization, evidence, risk, finance, recommendations and UI logic stay shared.

When an Atlassian/Forge platform fact matters, verify current official Atlassian documentation. Never invent endpoints, scopes, billing semantics, authentication behavior or Marketplace capabilities.

## Seven original specialist roles — mandatory

1. `market_product_architect` — narrow commercial V1, money-first UX, scope discipline.
2. `api_architect` — sourced Atlassian/Forge feasibility, auth/scopes/pagination/gateway contract.
3. `security_test_architect` — least privilege, false-positive/security/tenancy test contract.
4. `implementation_builder` — actual Forge product implementation.
5. `functional_redteam` — independent functional/financial adversarial audit; does not repair.
6. `security_redteam` — independent security/Marketplace adversarial audit; does not repair.
7. `release_integrator` — release director; consumes both audits, repairs findings, runs final gates, sets release truth.

Do not collapse these responsibilities into one generic agent. Do not add agents merely to create activity.

## Clean parallel-lane factory

There is exactly one workflow: `.github/workflows/atlas-factory.yml`.

When product work is required, it executes this DAG:

```text
market_product_architect ─┐
api_architect ────────────┼─> implementation_builder ─┬─> functional_redteam ─┐
security_test_architect ──┘                           └─> security_redteam ────┼─> release_integrator ─> deterministic gates ─> main
                                                                                 ┘
```

The three architecture lanes run in parallel. Their only persistent candidate outputs are canonical architecture-document patches passed as ephemeral GitHub artifacts inside the same run.

The builder starts from the same `main`, applies all three architecture patches, builds the product, passes smoke tests, and emits one ephemeral candidate patch.

Both red teams start independently from the exact same candidate patch and run in parallel. Their only durable outputs are fresh audit reports. They do not repair product code.

The release integrator starts from the exact candidate patch plus both fresh audits, repairs material findings, preserves the independent audit reports, runs the complete deterministic gate suite, and only then commits the integrated result to `main`.

No per-agent Git branches. No candidate branches. No continuation branches. No supervisor workflow. No separate watchdog workflow. No secondary CI workflow. `main` is the only persistent product truth.

## Resilience from the foundation

The single workflow is serialized by one concurrency group.

OpenCode installation and every OpenCode call have bounded transient retries. An OpenCode call that produces no output for five minutes is killed and classified as transient by the existing wrapper.

If any lane, audit, gate or provider call still fails, the run is not promoted. A final heartbeat job executes with `always()`, waits five minutes and redispatches the same workflow if Atlas is unfinished and no replacement run already exists. The `*/5` GitHub schedule remains a backup heartbeat if the run itself dies before redispatch.

This is the entire recovery model. Do not add a watcher for the watcher.

## Execution cleanup

The preflight job owns execution hygiene inside this same workflow. It may delete obsolete `factory/*` branches, disable historical workflow registrations, delete completed runs belonging to obsolete workflows, and keep only a small diagnostic tail of current Factory runs. Cleanup is housekeeping, not a controller and never decides product truth.

## Machine state

`state/factory_direction.json` is the only machine direction file.

Allowed states:
- BUILDING
- PARITY_READY_AWAITING_CREDENTIALS
- LIVE_DEV_VERIFIED
- BLOCKED_HUMAN
- MARKETPLACE_READY

`MARKETPLACE_READY` is the only final state and the only state allowed to set `continue=false`.

- BUILDING / LIVE_DEV_VERIFIED → run the full parallel-lane factory.
- PARITY_READY_AWAITING_CREDENTIALS → if credentials exist, run authenticated Forge register/lint/deploy/install; if absent, wait and re-check without wasting Ox.
- BLOCKED_HUMAN → never fabricate human evidence; re-check while preserving all automatable work already completed.
- MARKETPLACE_READY → stop.

## Deterministic authority

Agent judgment is never sufficient for promotion. Final release gates must include tests, backend/frontend typecheck, static/security/Marketplace checks, high/critical dependency audit, build and isolated Forge parity. Any failure means no promotion.

Live claims additionally require authenticated Forge evidence. Fixture/parity evidence is never called live.

## Anti-usine-à-gaz

Keep the specialist reasoning and genuine parallelism. Delete orchestration machinery that does not directly build, audit, validate, clean or retry the product.

For every product feature ask: **Does this increase the probability an admin installs Atlas, sees credible savings, trusts the recommendation and pays?** If not, defer it.

For every automation mechanism ask: **Does this directly enable parallel specialist work, independent audit, deterministic validation, recovery or hygiene?** If not, delete it.
