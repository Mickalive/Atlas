# Atlas — Cut My Atlassian Bill

Atlas is an Atlassian Renewal FinOps / License Cost Optimizer built Marketplace-first on Forge.

## Product sentence

Install → scan → show **estimated annual savings** → explain each opportunity → reclaim safely.

The V1 is intentionally narrow: find credible, financially meaningful Atlassian license waste fast enough that an admin understands the value in under five minutes.

## Autonomous control plane

Every agent is governed by `ATLAS_MASTER_PROMPT.md`, root `AGENTS.md` and one exact machine-checked card in `docs/agents/AGENT_CARDS.md`. Product agents cannot rewrite those rules or the workflows they execute.

The factory runs specialized API/product/security architects in parallel, one implementation builder, two independent red teams and one release integrator. `Atlas Factory Supervisor` continues accepted work automatically; `Atlas Ox and Runner Watchdog` retries only defensible transient infrastructure failures.

Until Atlassian credentials are connected, candidates must pass strict Forge parity mode on Node 24 with a real Forge-shaped manifest/architecture and deterministic fixture transport behind the same gateway used by live mode.

See:
- `ATLAS_MASTER_PROMPT.md`
- `PRODUCT_CONTRACT.md`
- `docs/FORGE_PARITY_MODE.md`
- `docs/FACTORY.md`
- `docs/SECRETS.md`
- `.github/workflows/atlas-factory.yml`

## Status

Autonomous Forge-parity build in progress. Live Forge registration/deployment requires the CI credentials documented in `docs/SECRETS.md`.
