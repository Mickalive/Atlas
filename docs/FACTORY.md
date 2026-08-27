# Atlas Product Factory

Atlas now uses two workflows only:

1. `.github/workflows/atlas-factory.yml` — autonomous product advancement and live Forge gate.
2. `.github/workflows/atlas-main-ci.yml` — deterministic read-only CI.

There is no Supervisor, separate Watchdog, architecture lane graph, candidate branch, continuation branch or kickoff trigger.

## One five-minute control loop

`Atlas Product Factory` is scheduled every five minutes and can also be started manually. It is serialized by one concurrency group with `cancel-in-progress: false`, so only one product cycle can run at a time.

The schedule itself is the recovery heartbeat. OpenCode/provider/network failures get bounded retries inside the run. If those retries still fail, the next scheduled factory cycle is the retry. There is no second controller racing the first one.

## State-driven behavior

The factory reads `state/factory_direction.json` and chooses exactly one mode:

- `MARKETPLACE_READY` → stop cleanly.
- `PARITY_READY_AWAITING_CREDENTIALS` without Forge credentials/site → wait cleanly and make **no Ox call**.
- `PARITY_READY_AWAITING_CREDENTIALS` with credentials/site → run the authenticated Forge live gate.
- `BUILDING`, `LIVE_DEV_VERIFIED` or `BLOCKED_HUMAN` → run the sole autonomous product worker against the concrete `next_focus`.

`MARKETPLACE_READY` is the only state with `continue=false`. Every unfinished state keeps a concrete `next_focus`.

## One product worker

The only OpenCode role is `release_integrator`. It edits the existing product directly, self-audits against the deterministic regression suite, verifies current Atlassian/Forge facts when necessary, runs the gates and updates release truth.

The old API architect, product architect, security architect, implementation builder and independent red-team lanes have been removed. Their useful product constraints remain encoded in the product constitution, product contract, tests and release evidence.

The wrapper protects the human-owned control plane from agent edits.

## Product gates

Gate-clean autonomous changes are committed directly to `main`; failed changes are not promoted.

Required gates are:

- `npm test`;
- backend + UI Kit typecheck;
- static product/security/Marketplace gates;
- high/critical dependency advisory gate;
- build gate;
- isolated Forge parity gate.

The independent deterministic CI runs the same product truth checks on relevant pushes to `main` and optionally runs authenticated `forge lint` when a registered app and Forge credentials exist.

## Forge live gate

When Forge credentials and a target Atlassian site exist, the same factory owns:

1. Forge CLI authentication;
2. app registration when the manifest still contains the placeholder app id;
3. immediate persistence of the registered app id before any deploy attempt;
4. authenticated `forge lint`;
5. development deploy;
6. Jira development installation;
7. transition to `LIVE_DEV_VERIFIED`.

The next product cycle then works on the real-environment verification checklist and Marketplace/security/privacy packaging. No fixture result is called live.

## Housekeeping

At the start of each factory run, `.github/scripts/atlas-housekeeping.sh`:

- disables historical workflow registrations other than the two canonical workflows;
- deletes completed runs from obsolete workflows;
- deletes completed factory runs from older control-plane definitions and keeps only a tiny current diagnostic tail;
- keeps only a short CI history;
- deletes every historical `factory/*` execution branch.

Historical release findings remain in git and release documentation; Actions/branch execution debris is not part of product state.

## Anti-usine-à-gaz rule

Automation must stay simpler than the product it is trying to finish. If continuity needs a supervisor for a watchdog for a supervisor, the design is wrong. The five-minute factory heartbeat, bounded retry wrapper, deterministic CI and machine state are the complete control plane.
