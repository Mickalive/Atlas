# ATLAS — MASTER AUTONOMOUS PRODUCT CONSTITUTION

Status: HUMAN-OWNED, BINDING, STABLE.

This file defines the product and the autonomous operating model. Agents may not rewrite, weaken or supersede it.

## Mission

Build a real Atlassian Marketplace product whose first useful question is:

**What can I safely remove before my next Atlassian renewal, and how much money will that save me?**

Atlas is an Atlassian Renewal FinOps / License Cost Optimizer. It is not generic user administration, Jira analytics, an AI assistant, consulting software, or broad SaaS-spend management. The principal UI metric is **ESTIMATED ANNUAL SAVINGS**.

## Product invariants

- Risk classes are SAFE NOW, REVIEW, KEEP, UNKNOWN.
- Missing evidence is UNKNOWN, never SAFE.
- Inactivity is a signal, not proof.
- False-positive removal recommendations are the worst failure.
- Partial scans remain visibly partial.
- Financial values expose assumptions and uncertainty.
- Tier/band/minimum pricing is modeled as scenarios, never naïve seats × list price.
- Recommendations explain WHAT, WHY, MONEY, RISK and EVIDENCE.
- V1 is Forge-first and read-only unless sourced API evidence proves that impossible.
- Priority products: Jira, Confluence, JSM, JPD, but support is claimed only where current APIs make it defensible.
- No external LLM/API dependency belongs in V1.
- Least privilege, minimal storage, tenant isolation and no secrets in repo/logs are mandatory.

## Architecture

Production transport/context sits behind the Atlas-owned `AtlassianGateway`. Fixtures may replace transport only for deterministic development and tests. There is no separate demo scanner or demo business logic: normalization, evidence, risk, finance, recommendations and UI models are shared downstream of acquisition.

When an Atlassian/Forge platform fact matters, verify current official Atlassian documentation rather than relying on memory. Never invent endpoints, scopes, Marketplace permissions, billing semantics or authentication behavior.

## Original seven-role team — preserved

The original Atlas specialist roles are binding and must remain present:

1. `market_product_architect` — freeze the narrowest commercially credible, money-first V1 and keep scope disciplined.
2. `api_architect` — establish the sourced Atlassian/Forge feasibility boundary, scopes, auth, pagination and gateway contract.
3. `security_test_architect` — define least-privilege rules, adversarial tests, tenant isolation and release blockers before implementation is trusted.
4. `implementation_builder` — build the actual Forge V1 from the architecture outputs on the real working tree.
5. `functional_redteam` — independently attack correctness and every claimed saving. It judges; it does not repair product code.
6. `security_redteam` — independently attack security, Marketplace trust, tenancy, auth, storage, scopes and fixture/live separation. It judges; it does not repair product code.
7. `release_integrator` — consume both independent audits, make the smallest material repairs, run release gates, update release truth and direct the next cycle.

The roles are preserved; the old orchestration is not. There are no per-role branches, candidate branches, continuation branches, mounted lane handoffs, supervisor workflows or separate watchdog workflows.

## Single sequential factory

There is exactly one GitHub Actions workflow: `.github/workflows/atlas-factory.yml`.

When product work is required it runs, on one working tree, in this order:

`market_product_architect → api_architect → security_test_architect → implementation_builder → functional_redteam → security_redteam → release_integrator → deterministic gates → commit`

Architect outputs are ordinary canonical repository documents, not branch handoffs. The builder reads those documents. Both red teams inspect the exact builder working tree and write only their audit reports. The release integrator is the only role allowed to repair audit findings after the independent judgments exist.

Agent judgment is not the final authority. The same workflow must pass tests, backend/frontend typecheck, static/security/Marketplace gates, high/critical dependency audit, build and isolated Forge parity before autonomous product changes are committed.

## One heartbeat, no supervisory stack

The single factory runs every five minutes and may also be started manually. It is serialized with one concurrency group and never cancels an active factory.

The schedule itself is recovery. OpenCode/provider/network failures are retried inside the OpenCode wrapper. If an OpenCode call produces no output for five minutes, the wrapper terminates it and treats it as transient. If retries are exhausted or any run fails, the next scheduled factory starts again from the last committed good `main`.

No autonomous agent may create another workflow, recovery controller, factory branch, candidate branch or continuation branch.

## Machine state

`state/factory_direction.json` is the only machine direction file.

Allowed states:
- `BUILDING`
- `PARITY_READY_AWAITING_CREDENTIALS`
- `LIVE_DEV_VERIFIED`
- `BLOCKED_HUMAN`
- `MARKETPLACE_READY`

`MARKETPLACE_READY` is the only final state and the only state allowed to set `continue=false`. Every other state keeps `continue=true` and an honest concrete next focus or blocker.

Behavior:
- `BUILDING` or `LIVE_DEV_VERIFIED`: run the complete seven-role sequence, deterministic gates, then commit only if green.
- `PARITY_READY_AWAITING_CREDENTIALS`: if Forge credentials/site are absent, exit cleanly and check again five minutes later without wasting Ox calls; if present, run authenticated Forge registration/lint/deploy/install.
- `BLOCKED_HUMAN`: never fabricate missing human evidence. Continue only work that is genuinely automatable; otherwise re-check on the heartbeat.
- `MARKETPLACE_READY`: stop product work cleanly.

## Authenticated Forge gate

When credentials are available, the same workflow owns Forge registration if the manifest still has the sentinel app id, persistence of the real app id, authenticated `forge lint`, development deploy and Jira installation. A successful deploy/install is not Marketplace readiness; it advances to `LIVE_DEV_VERIFIED`, after which the seven-role factory finishes real-environment verification and Marketplace/security/privacy packaging.

Live claims require live evidence. Fixture or parity results are never called live.

## Anti-usine-à-gaz

Do not build broad SaaS FinOps, AWS/Azure, ERP, Slack/Gmail/ServiceNow, giant RBAC, mobile, Data Center, AI copilots, cross-company benchmarking or complex executive dashboards now.

For every product feature ask: **Does this directly increase the probability that an admin installs Atlas, sees credible savings, trusts the recommendation and pays?** If not, defer it.

For every automation mechanism ask: **Is this necessary to build, independently audit, validate or retry the product?** If not, delete it.

## Done

Parity done = real Forge-shaped V1, production + fixture adapters behind the same gateway, tested risk/financial logic, money-first UI, no material known correctness/security blocker and strict deterministic parity green.

Live done additionally requires authenticated Forge lint/deploy/install and real-environment checks of tenant context, pagination, permissions, KVS behavior and recommendation correctness.

`MARKETPLACE_READY` additionally requires Marketplace/security/privacy packaging and required human attestations, no unresolved release blocker, and all deterministic gates green. Only then may continuation stop.
