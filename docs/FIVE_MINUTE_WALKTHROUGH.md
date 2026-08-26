# Atlas — Five-Minute Money Moment (AC1 walkthrough)

Scope: read-only V1. No write scopes exist, so every step below is safe by
construction. Interaction count target: ≤6 admin actions after install.

## 1. Install (admin action 1: authorize)

Marketplace install (or `forge install` on a development site) presents the
read-scope consent screen: nine granular read scopes only
(`docs/API_FEASIBILITY.md` §8 budget). Nothing writes to the tenant.

## 2. Open the admin page (no extra action beyond navigation)

`Apps → Atlas - Cut My Atlassian Bill` (jira:adminPage, registered as both
`useAsConfig` and `useAsGetStarted`). The dashboard mounts and immediately:

- invokes `bootstrap`, which queues the scan record and runs the first chunk
  synchronously inside a 17 s soft budget (25 s invocation hard stop), then
- polls `poll` every 2.5 s; each poll advances the checkpointed scan by one
  more chunk.

No configuration screen blocks progress. The scan is default-on.

## 3. Dollars appear automatically

As soon as derivation completes (seconds for small sites; minutes for large
ones via resumed chunks + the five-minute scheduled-trigger resume), the hero
renders:

```
ESTIMATED ANNUAL SAVINGS
$X / year
Safe now: $A · Review pool: $B · quote-required items: N
Scan COMPLETE · jira, confluence, jsm · window 180d · <ts> · dataMode=LIVE
```

Money leads; user counts appear nowhere on the first screen.

## 4. Optional: set renewal date (admin action 2)

One field (`YYYY-MM-DD`) converts savings into renewal framing: countdown,
T-minus exposure note, and renewal-ready exports.

## 5. Inspect any recommendation (admin action 3, per card)

Every card expands to WHY (rule id + thresholds), RISK checks (admin pattern,
service-account heuristic, exception list, window coverage, corroboration),
MONEY traceability (model version, effective date, band positions, boundary
crossings) and EVIDENCE lines with counts/timestamps sufficient to re-derive
the conclusion.

## 6. Export the renewal brief (admin action 4)

Buttons produce CSV or Markdown carrying generated-at, window coverage,
dataMode, pricing model version/effective date, the full assumptions block and
partial-stream list when applicable.

## Failure behavior (honesty affordances)

- Partial scans keep a persistent warning banner listing degraded streams;
  totals are scoped to covered populations.
- Fixture/demo data never appears in production builds: no runtime switch, no
  route, no import path (ADV-3 enforced statically).
- Missing permissions on one product degrade only that product with an explicit
  reason; other products continue.

Total admin interactions to first dollars: **authorize → open page**. All
further steps are optional refinements, keeping AC1 within budget.
