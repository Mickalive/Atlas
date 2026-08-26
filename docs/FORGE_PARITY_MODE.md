# Forge parity mode — until live Atlassian credentials are connected

Atlas must be developed against the closest practical approximation of the current Forge runtime without pretending that a local mock is Forge itself.

## Runtime baseline

- Node.js `24.x` in `manifest.yml` (`nodejs24.x`).
- Latest supported `@forge/*` packages where used.
- Latest Forge CLI installed in the parity container so CLI/version drift is visible even before login.
- Default Forge function memory assumption: 512 MB.
- Forge-like ephemeral `/tmp` budget: 512 MB.
- Product code must be structured for the current Forge invocation model and avoid cross-tenant/global mutable state.
- No external SaaS/LLM dependency in V1.

## What can be validated without an Atlassian account

The factory must validate all of the following before a candidate is allowed through the local gate:

1. The repository contains a real `manifest.yml`, not a proprietary substitute.
2. The manifest targets `nodejs24.x` and declares only scopes/modules the implementation actually uses.
3. The app installs/builds/tests on Node 24.
4. The same normalization, usage, risk, financial and recommendation code is used by both fixture mode and real Forge mode.
5. Atlassian access is behind a narrow adapter boundary. Production adapters may use `@forge/api` (`requestJira`, `requestConfluence`, Forge storage/context). Test adapters return deterministic fixtures with equivalent response shapes.
6. Fixture mode is impossible to mistake for a real scan in UI, logs or persisted state.
7. Tests cover pagination, partial responses, 401/403, 404 where meaningful, 429/rate limiting, 5xx/transient failure, missing activity data and malformed/unknown fields.
8. No result produced from incomplete data may be labelled as a complete scan.
9. No recommendation becomes SAFE merely because an activity field is missing.
10. Pricing/risk logic remains pure and independently testable from Atlassian transport.

## Required test fixtures

At minimum the builder should represent:

- active user;
- 30/60/90/180-day inactive users;
- never-observed activity;
- admin;
- probable service/technical account;
- product access through one group;
- redundant access through multiple groups;
- Jira-only vs Confluence-only evidence;
- JSM agent-like case;
- JPD creator-like case when supported by the feasibility map;
- missing/unknown activity;
- insufficient permissions;
- pagination;
- rate limit then retry/recovery;
- partial scan failure;
- tier/pricing boundary cases.

## Adapter rule

There must not be a separate “demo scanner”. The scanner consumes an interface owned by Atlas. For example:

`AtlassianGateway -> inventory/users/groups/activity/product access`

Two implementations may exist:

- `ForgeAtlassianGateway`: real Forge APIs/context.
- `FixtureAtlassianGateway`: deterministic development/test data.

Everything downstream of that boundary must be identical.

## Local parity container

`.github/scripts/forge-parity-check.sh` builds `forge-local/Dockerfile` and runs the candidate with:

- Node 24;
- 512 MB memory limit;
- 512 MB `/tmp`;
- no network during the runtime test phase.

This is intentionally stricter than normal local development. It catches accidental dependence on the public internet and gross memory/runtime assumptions. It is not a replacement for real `forge lint`, `forge deploy`, `forge install` or `forge tunnel`.

## What remains impossible until credentials are connected

Without a registered Forge app and installed development environment we cannot honestly validate:

- Atlassian-side manifest/module acceptance via authenticated Forge CLI;
- actual installation consent/scopes;
- real `requestJira` / `requestConfluence` behavior and tenant context;
- real Forge storage semantics;
- real platform invocation timing/egress behavior;
- Marketplace installation UX;
- organization-admin API access and auth viability.

When credentials are added, the existing final gate must switch from parity-only to real Forge lint/deploy/install without redesigning Atlas.
