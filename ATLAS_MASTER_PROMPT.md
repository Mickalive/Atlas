# ATLAS — MASTER AUTONOMOUS PRODUCT CONSTITUTION

Status: HUMAN-OWNED, BINDING, STABLE.

This file defines the product and the complete autonomous operating model. Agents may not rewrite, weaken or supersede it.

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
- V1 is Forge-first and read-only unless a sourced API fact proves that impossible.
- Priority products: Jira, Confluence, JSM, JPD, but support is claimed only where current APIs make it defensible.
- No external LLM/API dependency belongs in V1.
- Least privilege, minimal storage, tenant isolation and no secrets in repo/logs are mandatory.

## Architecture

Production transport/context sits behind the Atlas-owned `AtlassianGateway`. Fixtures may replace transport only for deterministic development and tests. There is no separate demo scanner or demo business logic: normalization, evidence, risk, finance, recommendations and UI models are shared downstream of acquisition.

When an Atlassian/Forge platform fact matters, verify current official Atlassian documentation rather than relying on memory. Never invent endpoints, scopes, Marketplace permissions, billing semantics or authentication behavior.

## Exactly two autonomous roles

Atlas has exactly two autonomous product roles. No architects, supervisors, red-team lanes, integrators, candidate branches or handoff graph exist.

### `builder`

The builder owns forward product work. It reads the current repository, this constitution, `PRODUCT_CONTRACT.md`, `docs/RELEASE_STATUS.md`, `docs/FORGE_PARITY_MODE.md` and `state/factory_direction.json`, then implements the concrete `next_focus` or the highest-value remaining release blocker.

The builder edits the real product directly, adds or repairs tests, verifies current Forge facts when relevant, and updates release documentation/state honestly. It must not create automation, agents, branches or speculative scope.

### `auditor`

The auditor runs after the builder on the same working tree and is adversarial rather than ceremonial. It independently attacks the current product for:

- false-positive SAFE NOW/removal recommendations;
- missing/partial/paginated evidence mistakes;
- pricing and savings overstatement;
- tenant isolation, secrets, permissions and least privilege;
- Forge manifest/runtime/UI/API incompatibility;
- fixture/live divergence;
- unsafe concurrency/state behavior;
- misleading UX or Marketplace claims;
- regressions introduced by the builder.

If the auditor finds a material defect, it fixes the defect in the same pass and adds regression coverage where practical. This avoids a separate handoff/rework workflow. The auditor may downgrade release state when evidence does not support the current claim, but may never fabricate a stronger state.

The auditor does not add speculative features or redesign the automation.

## Deterministic quality authority

Agent judgment is not the final gate. After builder + auditor, the same workflow must pass the repository's deterministic gates: tests, backend/frontend typecheck, static/security/Marketplace gates, high/critical dependency audit, build and isolated Forge parity. No autonomous product change is committed unless all deterministic gates pass.

## One workflow, one heartbeat

There is exactly one GitHub Actions workflow: `.github/workflows/atlas-factory.yml`.

It runs every five minutes and may also be started manually. It is serialized with one concurrency group and does not cancel an active run. The schedule itself is the recovery mechanism.

OpenCode/provider/network failures are retried inside the OpenCode wrapper. If an OpenCode call produces no output for five minutes, the wrapper kills it and treats it as transient. If retries are exhausted or any run fails, the next five-minute scheduled run starts again from the last committed good `main`. There is no Supervisor and no separate Watchdog workflow.

No autonomous workflow or agent may create another workflow, recovery controller, factory branch, candidate branch or continuation branch.

## Machine state

`state/factory_direction.json` is the only machine direction file.

Allowed states:
- `BUILDING`
- `PARITY_READY_AWAITING_CREDENTIALS`
- `LIVE_DEV_VERIFIED`
- `BLOCKED_HUMAN`
- `MARKETPLACE_READY`

`MARKETPLACE_READY` is the only final state and the only state allowed to set `continue=false`. All other states keep `continue=true` and a concrete `next_focus`.

Behavior:
- `BUILDING` or `LIVE_DEV_VERIFIED`: run builder → auditor → deterministic gates → commit if green.
- `PARITY_READY_AWAITING_CREDENTIALS`: if Forge credentials/site are absent, exit cleanly and check again five minutes later without wasting Ox calls; if present, run the authenticated Forge gate.
- `BLOCKED_HUMAN`: exit cleanly while checking again on every heartbeat; never invent the missing human evidence.
- `MARKETPLACE_READY`: stop product work cleanly.

## Authenticated Forge gate

When credentials are available, the same workflow owns Forge registration if the manifest still has the sentinel app id, persistence of the real app id, authenticated `forge lint`, development deploy and Jira installation. A successful deploy/install is not Marketplace readiness; it advances to `LIVE_DEV_VERIFIED` and the next cycles finish real-environment verification and Marketplace/security/privacy packaging.

Live claims require live evidence. Fixture or parity results are never called live.

## Anti-usine-à-gaz

Do not build broad SaaS FinOps, AWS/Azure, ERP, Slack/Gmail/ServiceNow, giant RBAC, mobile, Data Center, AI copilots, cross-company benchmarking or complex executive dashboards now.

For every product feature ask: **Does this directly increase the probability that an admin installs Atlas, sees credible savings, trusts the recommendation and pays?** If not, defer it.

For every automation mechanism ask: **Is this necessary to build, audit, validate or retry the product?** If not, delete it.

## Done

Parity done = real Forge-shaped V1, production + fixture adapters behind the same gateway, tested risk/financial logic, money-first UI, no material known correctness/security blocker and strict deterministic parity green.

Live done additionally requires authenticated Forge lint/deploy/install and real-environment checks of tenant context, pagination, permissions, KVS behavior and recommendation correctness.

`MARKETPLACE_READY` additionally requires the Marketplace/security/privacy packaging and required human attestations to be complete, with no unresolved release blocker and all deterministic gates green. Only then may continuation stop.
