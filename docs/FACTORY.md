# Atlas Product Factory

Atlas has one autonomous workflow:

`.github/workflows/atlas-factory.yml`

There is no Supervisor, separate Watchdog workflow, deterministic-CI workflow, architecture branch graph, candidate branch, continuation branch, kickoff workflow or housekeeping controller.

## One five-minute heartbeat

`Atlas Product Factory` runs every five minutes and may also be started manually. One concurrency group serializes the factory with `cancel-in-progress: false`.

The schedule itself is recovery. OpenCode installation and calls have bounded internal retries. An OpenCode call with no output for five minutes is terminated as transient. If a run still fails, the next five-minute scheduled run starts again from the last committed good `main`.

## Seven original specialist roles, one working tree

The original Atlas roles are preserved:

1. `market_product_architect`
2. `api_architect`
3. `security_test_architect`
4. `implementation_builder`
5. `functional_redteam`
6. `security_redteam`
7. `release_integrator`

When product work is required they execute sequentially on the same working tree:

`market_product_architect → api_architect → security_test_architect → implementation_builder → functional_redteam → security_redteam → release_integrator → deterministic gates → commit`

The three architects maintain their canonical product/API/security documents. The builder implements against those documents. The two red teams independently inspect the exact builder tree and write only `audit/FUNCTIONAL.md` and `audit/SECURITY.md`; they do not repair what they judge. The release integrator consumes both fresh reports and is the only role that repairs audit findings before final gates.

There are no role-specific branches or handoff branches. Architect documents and audit reports live on the current working tree.

## State behavior

The factory reads `state/factory_direction.json`:

- `MARKETPLACE_READY` → stop cleanly.
- `PARITY_READY_AWAITING_CREDENTIALS` without Forge credentials/site → wait cleanly, make no Ox call, and re-check on the next heartbeat.
- `PARITY_READY_AWAITING_CREDENTIALS` with credentials/site → run the authenticated Forge gate.
- `BUILDING` or `LIVE_DEV_VERIFIED` → run the complete seven-role product cycle.
- `BLOCKED_HUMAN` → do not invent the missing human evidence; re-check on the next heartbeat.

`MARKETPLACE_READY` is the only final stop state.

## Deterministic quality gates

After release integration, autonomous product changes must pass:

- `npm test`;
- backend + UI Kit frontend typecheck;
- static product/security/Marketplace gates;
- high/critical dependency advisory gate;
- build gate;
- isolated Forge parity gate.

Only the fully audited, gate-clean cycle is committed to `main`.

## Forge live gate

When Forge credentials and a target Atlassian site exist, the same workflow owns:

1. deterministic pre-live gates;
2. Forge CLI authentication;
3. app registration when the manifest still contains the sentinel app id;
4. authenticated `forge lint`;
5. development deploy;
6. Jira development installation;
7. transition to `LIVE_DEV_VERIFIED`.

A development install is not Marketplace readiness. The next seven-role cycle finishes real-environment verification and Marketplace/security/privacy packaging. Fixture/parity evidence is never described as live evidence.

## Minimal technical helpers

Only three GitHub helper scripts remain:

- `install-opencode-with-retry.sh` — install OpenCode with bounded transient retries;
- `run-opencode-with-retry.sh` — run one named agent with provider/network retries and the five-minute inactivity watchdog;
- `forge-parity-check.sh` — deterministic Forge-shaped parity validation.

They are helpers, not controllers. No helper schedules or dispatches another workflow.

## Anti-usine-à-gaz rule

Keep the specialist reasoning; delete orchestration machinery. If reliable product completion can be expressed as one sequential factory, do not add a supervisor to watch a watchdog to restart a supervisor.
