# ATLAS PRODUCT CONTRACT — CUT MY ATLASSIAN BILL

This file is binding for every autonomous agent in this repository.

## One sentence

Install Atlas → scan the Atlassian environment → show credible **ESTIMATED ANNUAL SAVINGS** immediately → explain each opportunity → enable safe remediation only when technically justified.

## Business wedge

**What can I safely remove before my next Atlassian renewal, and how much money will that save me?**

We are NOT building generic user management, Jira analytics, an AI assistant, a consultancy product, or an enterprise platform before validation.

## V1 definition

V1 does one thing extremely well: produce a financially credible report of potentially recoverable Atlassian license spend from real accessible data.

Target first experience:
1. Install.
2. Authorize minimum permissions.
3. Automatic scan.
4. Result.
5. Dollars.

Target time-to-value: under five minutes.

Priority products: Jira, Confluence, Jira Service Management, Jira Product Discovery — but claim support only where current APIs provide defensible evidence.

## Evidence and risk

Potential opportunities include never-used accounts, inactive accounts, unnecessary product access, oversized paid roles, redundant group-derived access, and other clearly evidenced waste.

Every recommendation must be classified as one of:
- SAFE NOW — strong evidence and low observed dependency risk.
- REVIEW — plausible savings, human review required.
- KEEP — evidence of real need.
- UNKNOWN — insufficient evidence.

Never equate inactivity with uselessness. Protect admins, service accounts, technical accounts, explicit exceptions, and critical users. False-positive removals are the worst product failure.

Every recommendation must answer WHAT, WHY, MONEY, RISK and EVIDENCE.

## Financial engine

The principal UI metric is **ESTIMATED ANNUAL SAVINGS**.

Never naïvely multiply seats by public list price when pricing uses tiers, progressive bands, minimums, plans, annual/monthly differences or other rules. Pricing logic must be versioned, testable and explainable. If exact customer billing is unavailable, label the output as an estimate and expose assumptions.

The dashboard starts with money, not user counts.

## Renewal framing

Structure the model around renewal from day one. Support an optional next-renewal date and show current estimated exposure, low-risk savings and review opportunities where defensible.

## Remediation

The first useful scan may be entirely read-only. This is preferred if it reduces installation friction.

Any later reclaim action requires preview, expected financial effect, dependency checks available from the APIs, explicit confirmation, audit logging, and rollback where technically possible. Never silently revoke risky access.

## Architecture

Keep it modular but not microservice-heavy:
- acquisition
- normalization
- usage evidence
- risk engine
- financial engine
- recommendation engine
- remediation
- audit log
- UI

Forge is strongly preferred for V1 if it does not fundamentally cripple the product.

## Security

Least privilege. Minimal storage. Tenant isolation. No secrets in logs or repo. Store only data needed for the product. Clearly document every Forge scope and external request. Do not request admin permissions speculatively.

## No fake AI

Do not add chatbots, LLM summaries, AI badges or opaque scoring. Deterministic and explainable logic wins. Models may only be used internally where they materially improve classification without hiding evidence.

## Tests

Test active, inactive, never-active, multi-group, admins, service accounts, JSM/JPD roles, missing data, rate limits, API errors, insufficient permissions, pricing tiers, estimates, rounding, remediation and rollback where implemented. Attack false positives aggressively.

## Marketplace first

Optimize product, copy and UX for relevant Marketplace intent: Atlassian license optimizer, Jira license cost optimizer, inactive Jira/Confluence users, reduce Atlassian cost, Atlassian renewal, JSM/JPD license optimization and license reclamation. Do not keyword-stuff.

## Competitors

Treat Recoup — License Cost Optimizer as a direct competitor, not proof of an empty niche. The strategic differentiation is renewal preparation and execution rather than merely reporting inactive seats. Do not copy competitors.

## Free → paid

A free audit must reveal enough value to prove money exists. Paid can later unlock complete recommendations, remediation, monitoring, history, workflows, renewal planning and multi-site. Do not make free useless.

## Do not build now

No external SaaS spend platform, AWS/Azure FinOps, ERP, Slack/Gmail/ServiceNow integration, giant RBAC, mobile, Data Center, AI copilot, global benchmark system or executive cockpit unless required for the narrow V1.

## Kill test

For every feature ask: **Does this directly increase the probability that an admin installs, sees real dollars and pays?** If not, defer it.

## Definition of done

Not “code compiles.” Not “tests pass.” Not “dashboard looks nice.”

Done means: **an actually installable Atlassian app that analyzes a real environment and shows a useful, explainable financial estimate compelling enough that someone could rationally pay for it.**
