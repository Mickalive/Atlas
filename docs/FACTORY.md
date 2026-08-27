# Atlas Product Factory

Atlas has one autonomous workflow:

`.github/workflows/atlas-factory.yml`

There is no Supervisor, separate Watchdog workflow, secondary CI workflow, per-agent branch graph, candidate branch, continuation branch or kickoff workflow.

## Clean DAG

When product work is required, the workflow runs:

```text
MARKET / PRODUCT ARCHITECT ─┐
API / FORGE ARCHITECT ─────┼─> IMPLEMENTATION BUILDER ─┬─> FUNCTIONAL RED TEAM ─┐
SECURITY / TEST ARCHITECT ──┘                           └─> SECURITY RED TEAM ────┼─> RELEASE INTEGRATOR ─> FULL GATES ─> main
                                                                                   ┘
```

The three architecture lanes run in parallel from the same committed `main`. They may only produce their canonical architecture documents.

The builder applies all three architecture patches, builds one exact candidate, and passes smoke tests.

The two red teams run independently and in parallel against that exact same candidate. They may write only their own audit report and may not repair product code.

The release integrator receives the candidate plus both fresh audit reports, repairs material findings, preserves the independent audits unchanged, runs the complete deterministic release gates and only then promotes to `main`.

Inter-job handoff uses one-run GitHub artifacts containing patches/reports. Nothing persists as a work branch. `main` is the only persistent product truth.

## Resilience

One concurrency group serializes the Factory. `cancel-in-progress: false` prevents a newer heartbeat from killing a valid product cycle.

OpenCode installation and every agent call have bounded transient retries. The OpenCode wrapper also kills a call after five minutes without output and classifies the hang as transient.

A final `heartbeat` job uses `if: always()`. Whether an architect, builder, red team, integrator, gate or provider fails, the heartbeat waits five minutes and redispatches the same Factory if Atlas is unfinished and no replacement run already exists.

The `*/5 * * * *` schedule remains a backup if the entire run/runner dies before the heartbeat can redispatch. This is the full recovery model; there is no watcher for the watcher.

## Clean-slate preflight

The `preflight` job is also the only execution-hygiene mechanism. It:

- deletes obsolete `factory/*` branches;
- disables historical workflow registrations other than `atlas-factory.yml`;
- deletes completed runs belonging to obsolete workflows;
- keeps only a small diagnostic tail of completed current Factory runs.

This housekeeping never decides product truth and never spawns another controller.

## Seven original specialist roles

1. `market_product_architect`
2. `api_architect`
3. `security_test_architect`
4. `implementation_builder`
5. `functional_redteam`
6. `security_redteam`
7. `release_integrator`

Their role definitions and canonical cards remain in `.opencode/agents/` and `docs/agents/AGENT_CARDS.md`.

## State behavior

`state/factory_direction.json` is the only machine direction file.

- `BUILDING` / `LIVE_DEV_VERIFIED` → run the full parallel DAG.
- `PARITY_READY_AWAITING_CREDENTIALS` without Forge credentials/site → wait without wasting Ox; heartbeat rechecks later.
- `PARITY_READY_AWAITING_CREDENTIALS` with credentials/site → run the authenticated Forge live gate.
- `BLOCKED_HUMAN` → preserve honest human blockers and recheck.
- `MARKETPLACE_READY` → final stop.

`MARKETPLACE_READY` is the only state allowed to set `continue=false`.

## Quality gates

Before promotion to `main`, the release-integrated candidate must pass:

- unit/integration tests;
- backend + UI Kit frontend typecheck;
- static product/security/Marketplace gates;
- high/critical dependency audit;
- build;
- isolated Forge parity.

The builder also runs smoke tests before the candidate is handed to the red teams.

## Forge live gate

When Forge credentials and a target Atlassian site exist, the same workflow owns deterministic pre-live gates, registration if needed, persistence of the real Forge app id, authenticated `forge lint`, development deploy, Jira development install and transition to `LIVE_DEV_VERIFIED`.

A development install is not Marketplace readiness. The next full lane cycle performs live-boundary verification and Marketplace/security/privacy completion.

## Anti-usine-à-gaz rule

Preserve specialist reasoning and genuine parallelism. Delete machinery that does not directly build, independently audit, validate, clean or retry the product.
