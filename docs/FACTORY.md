# Atlas 24h Factory

The factory is deliberately smaller than SPIDER. It uses specialized lanes only where parallelism reduces wall-clock time or independent review reduces risk.

## Lanes

1. **API Architect** — current Atlassian/Forge feasibility, auth, scopes, rate limits and live-data truth. Produces `docs/API_FEASIBILITY.md`.
2. **Market/Product Architect** — competitor reality, V1 cuts, UX, renewal framing and Marketplace distribution. Produces `docs/PRODUCT_V1.md`.
3. **Security/Test Architect** — least privilege, threat model, tenant isolation, false-positive test plan and Marketplace blockers. Produces `docs/SECURITY_TEST_PLAN.md`.
4. **Implementation Builder** — synthesizes the three lanes into the actual Forge application and automated tests.
5. **Functional Red Team** — independently attacks correctness, especially false-positive savings and financial math.
6. **Security Red Team** — independently attacks scopes, auth, tenancy, secret handling and unsafe remediation.
7. **Release Integrator** — fixes material findings, runs the gates, leaves one candidate, and prepares/deploys a real Forge development build when credentials exist.

## Lifecycle

Research lanes run in parallel on isolated branches. Builder consumes them via worktrees. Red teams independently inspect the same build. Release Integrator consumes both audits and owns the only repair pass. A candidate reaches `main` only after local CI gates pass.

When Forge credentials are configured, the final gate also registers the app if necessary, runs Forge lint/deploy and optionally installs/upgrades it on the configured test site.

The workflow is scheduled every three hours and is concurrency-locked: it improves the existing product instead of starting overlapping factories.

## Anti-usine-à-gaz rules

- No agent exists only to supervise another agent.
- Research must end in implementation constraints, not essays.
- Builder owns one coherent codebase.
- Auditors cannot mutate the build they judge.
- One integrator fixes, tests and chooses the candidate.
- A lane that cannot materially improve an installable V1 must stop and document the blocker.
- Never fabricate a live Atlassian result when credentials or APIs are absent.
