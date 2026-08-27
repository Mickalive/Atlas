# ATLAS — MASTER AUTONOMOUS PRODUCT CONSTITUTION

Status: HUMAN-OWNED, BINDING, STABLE.

This file is the common product constitution for autonomous Atlas work. Autonomous agents may not rewrite, weaken or supersede it. Changes require explicit human authorization.

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

When an Atlassian/Forge platform fact matters, verify current official Atlassian documentation instead of relying on stale memory. Do not invent endpoints, scopes, Marketplace permissions or auth paths. Organization API credentials used for testing remain test-only unless a Marketplace-compliant production path is established.

## Autonomous worker

Atlas has one autonomous product worker: `release_integrator`. It owns implementation, targeted self-audit, repair, deterministic validation, release documentation and machine state. This is intentionally a single role: the old architect/builder/red-team/integrator lane graph is retired.

The worker may not modify the human-owned product constitution, product contract, Forge parity rules, agent definition, GitHub workflows or GitHub helper scripts. The execution wrapper restores those paths after every OpenCode call.

Independent correctness does not come from more agents. It comes from deterministic tests, false-positive regression matrices, static security gates, Forge parity checks and authenticated live verification.

## Autonomous continuity

Machine state lives at `state/factory_direction.json`. Allowed release statuses: `BUILDING`, `PARITY_READY_AWAITING_CREDENTIALS`, `LIVE_DEV_VERIFIED`, `MARKETPLACE_READY`, `BLOCKED_HUMAN`.

`MARKETPLACE_READY` is the only final stop state and requires `continue=false`. Every other status remains unfinished and keeps `continue=true` with a concrete `next_focus`.

There is exactly one scheduled control loop: `.github/workflows/atlas-factory.yml`, every five minutes. There is no Supervisor and no separate Watchdog. The schedule itself is the recovery heartbeat.

The factory is serialized with one concurrency group and never cancels an in-progress factory. Transient OpenCode/provider/network failures are retried a bounded number of times inside the same run. If the run still fails, the next five-minute schedule is the retry. Deterministic product failures are never hidden by blind infrastructure reruns; a later cycle must repair the product.

When state is `PARITY_READY_AWAITING_CREDENTIALS` and Forge credentials/site are absent, the factory does **not** call OpenCode or repeatedly rebuild a gate-clean product. It exits cleanly and simply re-checks credentials at the next heartbeat. When credentials appear, the same factory owns authenticated Forge registration if needed, lint, development deploy and Jira installation.

No autonomous workflow may create supervisory workflows, duplicate recovery loops, factory lane branches, candidate branches or continuation branches.

## Anti-usine-à-gaz

Do not build broad SaaS FinOps, AWS/Azure, ERP, Slack/Gmail/ServiceNow, giant RBAC, mobile, Data Center, AI copilots, cross-company benchmarking or complex executive dashboards now.

For every feature ask: **Does this directly increase the probability that an admin installs Atlas, sees credible savings, trusts the recommendation and pays?** If not, defer it.

Apply the same rule to automation: if a workflow, agent, branch, state machine or recovery mechanism does not directly improve reliable product completion, remove it rather than supervising it with another layer.

## Done

Parity done = real Forge-shaped V1 with real manifest, production + fixture adapters behind the same gateway, tested risk/financial logic, money-first UI, no material correctness/security blocker and strict parity gate passing.

Live done additionally requires authenticated Forge lint/deploy/install and a real-environment scan with spot checks of tenant context, pagination, permissions, KVS behavior and recommendation correctness.

`MARKETPLACE_READY` requires the live gate to be complete, no unresolved release blocker, release/security/privacy/Marketplace packaging to be present, and all deterministic release gates green. Only then may autonomous continuation stop.
