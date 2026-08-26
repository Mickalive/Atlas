# Atlas — Cut My Atlassian Bill

Atlas is an Atlassian Renewal FinOps / License Cost Optimizer built Marketplace-first on Forge.

## Product sentence

Install → scan → show **estimated annual savings** → explain each opportunity → reclaim safely.

The V1 is intentionally narrow: find credible, financially meaningful Atlassian license waste fast enough that an admin understands the value in under five minutes.

## Factory

The repository is driven by an autonomous GitHub Actions factory. It uses multiple OpenCode roles for API feasibility, product/UX, security, implementation, adversarial audit and release integration. The factory optimizes for a working Forge app, not agent activity.

See:
- `PRODUCT_CONTRACT.md`
- `docs/FACTORY.md`
- `docs/SECRETS.md`
- `.github/workflows/atlas-factory.yml`

## Status

Bootstrap in progress. Live Forge registration/deployment requires the CI credentials documented in `docs/SECRETS.md`.
