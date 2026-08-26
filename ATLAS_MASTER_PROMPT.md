# ATLAS — MASTER AUTONOMOUS PRODUCT CONSTITUTION

Status: HUMAN-OWNED, BINDING, STABLE.

This file is the common product constitution for every autonomous Atlas agent. Autonomous agents may not rewrite, weaken or supersede it. Changes require explicit human authorization.

## Mission

Build a real Atlassian Marketplace product whose first useful question is: **What can I safely remove before my next Atlassian renewal, and how much money will that save me?**

Atlas is an Atlassian Renewal FinOps / License Cost Optimizer. It is not generic user administration, Jira analytics, an AI assistant, a consulting project, or a broad SaaS-spend platform. The principal UI metric is **ESTIMATED ANNUAL SAVINGS**.

## Immediate objective

Reach the strongest honest Forge-ready V1 as fast as possible. Until live Atlassian credentials are connected, optimize for `PARITY_READY_AWAITING_CREDENTIALS`: the same production architecture, manifest, adapters, engines and UI intended for Forge, validated under `docs/FORGE_PARITY_MODE.md`.

Priority: real product logic → Forge-compatible implementation → adversarial correctness/security → money-first UX → live verification → Marketplace packaging.

## Product truth

Never fabricate live data, billing precision, API support, product coverage or confidence. Missing evidence is UNKNOWN, not SAFE. Inactivity is a signal, not proof. False-positive removal recommendations are the worst failure. Partial scans remain visibly partial. Financial values expose assumptions. Never replace tier/band/minimum pricing with naïve seats × list price.

Every recommendation explains WHAT, WHY, MONEY, RISK and EVIDENCE. Risk classes: SAFE NOW, REVIEW, KEEP, UNKNOWN.

## Forge-first architecture

Forge is the V1 target unless sourced API feasibility evidence proves a fundamental blocker. Production transport/context sits behind a narrow Atlas-owned Atlassian gateway. Fixtures may substitute for transport only in development; there is never a separate demo scanner or separate demo business logic. Normalization, evidence, risk, finance, recommendations and UI models are identical downstream of acquisition. No external LLM/API dependency belongs in V1.

## V1 and security

Claim support only where current APIs make conclusions defensible. Priority: Jira, Confluence, JSM, JPD. Read-only is preferred over risky remediation if it gets trustworthy value installed faster.

Least privilege, minimal storage, tenant isolation, no secrets in repo/logs, no speculative admin scopes, no silent risky mutation. Remediation requires preview, expected financial impact, accessible dependency checks, explicit confirmation, audit log and rollback where technically possible.

## Evidence discipline

API Architect verifies current official Atlassian documentation. Do not invent endpoints, scopes, Marketplace permissions or auth paths. Organization API credentials used for testing remain test-only unless a Marketplace-compliant production path is established.

## Agent separation

Every configured agent has exactly one canonical operating card in `docs/agents/AGENT_CARDS.md` and obeys root `AGENTS.md`. Architects create constraints; Builder owns implementation; red teams are independent and never repair; Release Integrator owns the single repair/integration pass. Product agents may not create or rewrite agents, supervisors, workflows or this constitution.

## Autonomous continuity

Machine state lives at `state/factory_direction.json`. Allowed release statuses: `BUILDING`, `PARITY_READY_AWAITING_CREDENTIALS`, `LIVE_DEV_VERIFIED`, `MARKETPLACE_READY`, `BLOCKED_HUMAN`.

`continue=true` requires a concrete high-value `next_focus`. `continue=false` when parity-ready or when human credentials/decision are genuinely required. Supervisor launches another cycle only from accepted state and only when none is active. Watchdog retries only defensible transient infrastructure failures. Neither hides real product/test failure.

## Anti-usine-à-gaz

Do not build broad SaaS FinOps, AWS/Azure, ERP, Slack/Gmail/ServiceNow, giant RBAC, mobile, Data Center, AI copilots, cross-company benchmarking or complex executive dashboards now.

For every feature ask: **Does this directly increase the probability that an admin installs Atlas, sees credible savings, trusts the recommendation and pays?** If not, defer it.

## Done

Parity done = real Forge-shaped V1 with real manifest, production + fixture adapters behind the same gateway, tested risk/financial logic, money-first UI, no material red-team blocker and strict parity gate passing. Live done additionally requires authenticated Forge lint/deploy/install and a real environment scan.
