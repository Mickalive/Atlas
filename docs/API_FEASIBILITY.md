# Atlas — API Feasibility Assessment

Status: **SOURCE-VERIFIED** (api_architect, 2026-08-27)
This document is the canonical source for what Atlassian/Forge APIs Atlas may safely use in V1. Every endpoint, scope, and pagination behavior is verified against official Atlassian documentation accessed on 2026-08-27. The builder, security test architect, red teams, and release integrator must reference this document — never invent endpoints, scopes, or auth behavior.

## 1. Platform boundary

Atlas V1 targets **Jira Cloud** and **Confluence Cloud** only. No Data Center, no Server, no on-premise. All API calls flow through `@forge/api` (`requestJira`, `requestConfluence`) or the org-admin enrichment path (feature-flagged OFF by default, reaching `api.atlassian.com` via absolute URL).

Authentication: Forge app identity (`asApp()`) for all V1 endpoints. Optional `asUser()` fallback is gated behind `userFallback: true` and only fires after a 401 on `asApp()` — never in the default request path. Org-admin enrichment uses a separate Bearer token supplied by configuration (TEST-ONLY in V1, disabled by default).

## 2. Scope inventory

Atlas declares exactly **9 scopes** in `manifest.yml`:

| # | Manifest scope | Classic equivalent | Granular? | Atlas usage |
|---|---|---|---|---|
| 1 | `read:license:jira` | — | Granular | License/plan info |
| 2 | `read:application-role:jira` | — | Granular | Seat inventory via application roles |
| 3 | `read:user:jira` | `read:jira-user` | Granular | User enumeration, group members, search |
| 4 | `read:group:jira` | `read:jira-user` | Granular | Group listing, group membership |
| 5 | `read:avatar:jira` | `read:jira-user` | Granular | Tolerated-null in user payloads (VERIFY-LIVE) |
| 6 | `read:jira-work` | `read:jira-work` | Classic | Issue search/activity evidence |
| 7 | `read:content-details:confluence` | — | Granular | Confluence contribution search |
| 8 | `read:user:confluence` | — | Granular | Confluence group membership |
| 9 | `read:group:confluence` | — | Granular | Confluence group listing |

Zero write scopes. Zero admin scopes. No `manage:jira-configuration` (the classic scope that most admin endpoints require). No `read:audit-log:jira`. No `read:email-address:jira`.

### Scope budget enforcement

Every scope must map to at least one real call site in a transport implementation (`src/gateway/forge/forgeGateway.ts` or `src/gateway/fixture/fixtureGateway.ts`). This is enforced by `scripts/static-gates.mjs` (GATE-2, hardened per SEC-H1). A scope with no exercising call fails the build.

## 3. Endpoint table — Jira REST v3

All Jira paths use the v3 API (`/rest/api/3/...`). Forge lint requires v3 paths for Jira.

### 3.1 Application roles — `GET /rest/api/3/applicationrole`

- **Official docs:** "Get all application roles" — Application roles resource.
- **Required permission:** "Administer Jira" global permission.
- **Scopes:** Classic `manage:jira-configuration` OR granular `read:application-role:jira`.
- **Forge support:** YES — Forge example provided in docs. Note: "Connect apps cannot access this REST resource" (Connect restriction does NOT apply to Forge).
- **Pagination:** None — returns full array of all roles.
- **Response shape:** Bare JSON array of `ApplicationRole` objects. Each role has: `key`, `name`, `groups` (string[]), `groupDetails` (array of `{groupId, name}`), `userCount`, `numberOfSeats`, `remainingSeats`, `hasUnlimitedSeats`, `platform`, `selectedByDefault`, `defined`.
- **Atlas usage:** Resolves seat counts per product (Jira Software, Jira Core, JSM, JPD), group assignments, and license ceiling. This is the primary source for seat inventory.
- **Feasibility verdict:** **GO**.

### 3.2 Users — `GET /rest/api/3/users`

- **Official docs:** "Get all users default" — Users resource.
- **Required permission:** "Browse users and groups" global permission.
- **Scopes:** Classic `read:jira-user` OR granular `read:user:jira`, `read:application-role:jira`, `read:avatar:jira`, `read:group:jira`.
- **Forge support:** YES — Forge example provided in docs. Note: "Connect apps cannot access this REST resource" (Connect restriction).
- **Pagination:** Offset-based: `startAt`, `maxResults` query params. Response: bare JSON array (no `values` wrapper in some versions; Atlas code handles both `Array.isArray(json.values)` and `Array.isArray(json)`).
- **Response shape:** Array of `User` objects with `accountId`, `accountType`, `active`, `avatarUrls`, `displayName`, `emailAddress`, `key`, `name`, `self`.
- **Forge caveat:** The "emailAddress" field may be hidden by user profile visibility settings. Atlas only uses the local-part hint for service-account heuristics (SEC-3/SEC-L2).
- **Atlas usage:** Primary user enumeration. Combined with group membership to detect seat access.
- **Feasibility verdict:** **GO** — VERIFY-LIVE that `emailAddress` is returned under Forge `asApp()` identity (privacy controls may suppress it).

### 3.3 User bulk — `GET /rest/api/3/user/bulk` (Experimental)

- **Official docs:** "Bulk get users" — Users resource. Marked **Experimental**.
- **Required permission:** "Permission to access Jira."
- **Scopes:** Classic `read:jira-user` OR granular `read:application-role:jira`, `read:group:jira`, `read:user:jira`, `read:avatar:jira`.
- **Forge support:** YES — Forge example provided.
- **Pagination:** Offset-based with `isLast`, `startAt`, `maxResults`, `total`.
- **Status:** NOT USED in V1. Kept as a potential future optimization for large-tenant user enumeration. Experimental status means behavior may change.
- **Feasibility verdict:** **BLOCKED** (experimental; not needed for V1).

### 3.4 Group bulk — `GET /rest/api/3/group/bulk`

- **Official docs:** "Bulk get groups" — Groups resource. Marked **Experimental**.
- **Required permission:** "Browse users and groups" global permission.
- **Scopes:** Classic `read:jira-user` OR granular `read:group:jira`.
- **Forge support:** YES — Forge example provided.
- **Pagination:** Offset-based: `startAt`, `maxResults`. Response: `PageBeanGroupDetails` with `isLast`, `startAt`, `total`, `values[]` where each value has `groupId` and `name`.
- **Atlas usage:** Enumerates all Jira groups to discover group-to-role mappings.
- **Feasibility verdict:** **GO** (experimental but stable; Forge example confirms access).

### 3.5 Group members — `GET /rest/api/3/group/member`

- **Official docs:** "Get users from group" — Groups resource.
- **Required permission:** "Browse users and groups" or "Administer Jira" global permission.
- **Scopes:** Classic `manage:jira-configuration` OR granular `read:group:jira`, `read:user:jira`, `read:avatar:jira`. Note: `read:avatar:jira` is required even though Atlas consumes none of the avatar subfields.
- **Forge support:** YES — Forge example provided.
- **Pagination:** Offset-based: `startAt`, `maxResults`, `includeInactiveUsers`. Response: `PageBeanUserDetails` with `isLast`, `startAt`, `total`, `values[]`, `nextPage` (href string).
- **Important:** Supports `includeInactiveUsers=true` parameter. Atlas uses this to ensure inactive users are visible in seat enumeration.
- **Atlas usage:** Resolves which users belong to each group, enabling access-path analysis.
- **Feasibility verdict:** **GO**.

### 3.6 Issue search (enhanced) — `POST /rest/api/3/search/jql`

- **Official docs:** "Search for issues using JQL enhanced search (POST)" — Issue search resource.
- **Required permission:** "Browse projects" project permission for relevant projects.
- **Scopes:** Classic `read:jira-work` OR granular `read:issue-details:jira`, `read:field.default-value:jira`, `read:field.option:jira`, `read:field:jira`, `read:group:jira`.
- **Forge support:** YES — Forge example provided.
- **Pagination:** **Token-based (cursor).** Request body includes `nextPageToken` for continuation. Response includes `isLast: boolean`, `nextPageToken: string | absent`. Absence of `nextPageToken` after a non-empty page IS the documented end signal.
- **Request body:** `{ jql, fields: string[], maxResults, nextPageToken? }`.
- **Response shape:** `{ isLast, issues: [...], maxResults, startAt, total? }`. Each issue has `key`, `fields` including `creator`, `assignee`, `reporter`, `created`, `updated`.
- **Atlas usage:** Site-wide issue activity sweep. JQL: `updated >= "<date>" ORDER BY updated DESC`. Extracts creator/assignee/reporter account IDs and timestamps to determine per-user Jira activity recency.
- **Deviation record:** This endpoint was not in the original feasibility endpoint table. Added per addendum A1 (VERIFY-LIVE for exact scope string). The scope `read:jira-work` is confirmed correct per official docs.
- **Feasibility verdict:** **GO**.

### 3.7 License (instance) — `GET /rest/api/3/instance/license`

- **Official docs:** "Get license" — License metrics resource. Marked **Experimental**.
- **Required permission:** None.
- **Scopes:** Classic `manage:jira-configuration` OR granular `read:license:jira`. Connect: `READ`.
- **Forge support:** YES — Forge example provided.
- **Pagination:** None.
- **Response shape:** `{ applications: [{ id, plan }] }`. Plan values: "PAID", "FREE".
- **Atlas usage:** Determines which products are installed and their plan type (PAID vs FREE). Informational; drives display, not classification.
- **Feasibility verdict:** **GO** (experimental; tolerant of absence via 404/malformed handling).

### 3.8 License (approximate count) — `GET /rest/api/3/license/approximateLicenseCount`

- **Official docs:** "Get approximate license count" — License metrics resource. Marked **Experimental**.
- **Required permission:** "Administer Jira" global permission.
- **Scopes:** Classic `manage:jira-configuration` OR granular `read:license:jira`.
- **Forge support:** YES — Forge example provided. Note: "Connect apps cannot access this REST resource" (Connect restriction).
- **Pagination:** None.
- **Response shape:** `{ key, value }` where value is a stringified count. Cached with 7-day lifecycle.
- **Atlas usage:** Provides a cross-product approximate seat count. Tolerated absent (404 returns null).
- **Feasibility verdict:** **GO** (experimental; tolerant of absence).

### 3.9 License (approximate by product) — `GET /rest/api/3/license/approximateLicenseCount/product/{applicationKey}`

- Same as 3.8 but scoped to a specific product key (e.g., `jira-software`, `jira-servicedesk`).
- **Atlas usage:** NOT USED in V1. Application roles provide more granular seat data.
- **Feasibility verdict:** **GO** but not needed.

## 4. Endpoint table — Confluence REST (v1 wiki paths)

Atlas uses Confluence v1 wiki REST paths (`/wiki/rest/api/...`). These are the paths `requestConfluence` routes to via `@forge/api`.

### 4.1 Confluence groups — `GET /wiki/rest/api/group`

- **Official docs:** Confluence Cloud REST API v2 group resource. The v1 path `/wiki/rest/api/group` is used by Forge `requestConfluence`.
- **Required permission:** Varies by endpoint.
- **Scopes:** `read:group:confluence`.
- **Forge support:** YES — Forge `requestConfluence` routes `/wiki/` paths to Confluence.
- **Pagination:** Offset-based: `start`, `limit`. Response: results array. **No reliable `totalSize`** — surfaced as degraded field `meta.total = null`.
- **Response shape:** `{ results: [{ type, username, displayName }] }` (v1 shape).
- **Atlas usage:** Enumerates Confluence groups to find candidates for Confluence seat access analysis.
- **Feasibility verdict:** **GO WITH DEGRADED CONFIDENCE** — `totalSize` unreliable; scan cannot claim completeness of group listing.

### 4.2 Confluence group members — `GET /wiki/rest/api/group/{groupId}/member`

- **Required permission:** Varies.
- **Scopes:** `read:user:confluence`, `read:group:confluence`.
- **Pagination:** Offset-based: `start`, `limit`. Response: results array.
- **Response shape:** Users wrapped under `account` key with `accountId`, `displayName`, `active`, `email`, `type`. Email may surface as `emailAddress` or `email` depending on wiki REST version.
- **Atlas usage:** Resolves which users belong to each Confluence group.
- **Feasibility verdict:** **GO WITH DEGRADED CONFIDENCE** — same totalSize caveat.

### 4.3 Confluence search (contributions) — `GET /wiki/rest/api/search`

- **Required permission:** Varies.
- **Scopes:** `read:content-details:confluence`.
- **Pagination:** Cursor-based: `cursor` query param. Response: results array. Absence of continuation pointer = end of results.
- **CQL filter:** `contributor="accountid:{accountId}" and lastmodified>="{windowStart}" order by lastmodified desc`.
- **Response shape:** `{ results: [{ content: { id }, version: { when } }] }`.
- **Atlas usage:** Per-account contribution sweep. Window-filtered CQL ensures returned hits ARE within-window activity. `version.when` timestamp is preserved through shared adapter (functional BLOCKER 1).
- **Feasibility verdict:** **GO**.

## 5. Pagination contract

Atlas supports two pagination flavors, determined per-endpoint:

### 5.1 Offset pagination (`flavor = 'offset'`)

Used by: `listJiraUsers`, `listGroups`, `listGroupMembers`, `listConfluenceGroups`, `listConfluenceGroupMembers`.

- **Request:** `startAt=<offset>&maxResults=<limit>` (Jira) or `start=<offset>&limit=<limit>` (Confluence).
- **Response metadata:** `startAt`, `total` (when reliable), `isLast` (when explicit).
- **Termination:** `isLast === true` OR `startAt + slice.length >= total`.
- **UNKNOWN termination:** When response carries NEITHER an explicit `isLast` NOR a reliable `total`, `isLast` is surfaced as `null`. The scan service treats unverifiable continuation as INCOMPLETE — never as complete (functional HIGH 5).
- **Mid-loop page-size changes:** Code must honor returned page sizes, not assumed sizes.

### 5.2 Token/cursor pagination (`flavor = 'token'`)

Used by: `searchIssueActivity` (POST `/rest/api/3/search/jql`), `searchConfluenceContributions`.

- **Request:** `nextPageToken` in request body (JQL) or `cursor` query param (Confluence).
- **Response metadata:** `isLast: boolean`, `nextPageToken` (JQL) or continuation href (Confluence).
- **Termination:** Absence of `nextPageToken` / next link after a non-empty page IS the documented end signal.

### 5.3 Pacing and retry

Central policy in `src/gateway/pacing.ts`:

- **Max attempts:** 4 (configurable).
- **Retry-After honored as MINIMUM delay** (floor, not suggestion).
- **Exponential backoff:** base 500ms, max 8s, jitter [0.7, 1.3].
- **401/403:** Never retried; classified `PERMISSION_DEGRADED`.
- **429:** Retried with Retry-After floor.
- **5xx:** Retied (all Atlas reads are idempotent GETs/POSTs).
- **Other 4xx:** Not retried.
- **One-shot asUser fallback:** After 401 on `asApp()`, one retry as `asUser()` is permitted ONLY when `userFallback: true` is explicitly enabled. Default: fail-closed (no fallback).

## 6. Org-admin enrichment (feature-flagged OFF in V1)

- **Endpoint:** `GET https://api.atlassian.com/admin/v1/orgs/{orgId}/users` — absolute URL, not Forge-proxied.
- **Auth:** Bearer token via `orgEnrichment.getApiKey()`. Token held transiently, never persisted.
- **Pagination:** Cursor-based via `links.next` href.
- **Response shape:** `{ data: [{ account_id, access_billable, last_active, added_to_org, product_access: [...] }] }`.
- **V1 status:** COMPILED but INERT. `orgEnrichment.enabled` defaults to `false`. `api.atlassian.com` is NOT declared as a manifest remote — an undeclared remote cannot be reached; a declared-but-unexercised one would violate GATE-2/BLK-5.
- **Enabling later requires:** security review of secret storage, adding exactly one remote declaration, and flipping the flag.
- **Feasibility verdict:** **GO WITH CONSTRAINTS** (optional; disabled by default).

## 7. App self-license

- **Endpoint:** `GET /forge/app/v1/license` — Forge-internal endpoint.
- **Scopes:** None required (Forge-internal).
- **Response shape:** `{ active, type, isEvaluation, subscriptionEndDate, capabilitySet }`.
- **Atlas usage:** Detects evaluation vs paid license for the app itself. Used to gate Marketplace behavior.
- **Feasibility verdict:** **GO**.

## 8. Product coverage and verdicts

| Product | Rung | Verdict | Evidence source | Limitations |
|---|---|---|---|---|
| **Jira** | L1 | **GO** | Application roles (seat inventory), user enumeration, group membership, issue search (activity evidence), license info | `emailAddress` visibility under Forge identity VERIFY-LIVE; `/rest/api/3/users` has Connect restriction but Forge example confirms access |
| **Confluence** | L2 | **DEGRADED** | Group listing, group membership, contribution search | `totalSize` unreliable on group listing; seat enumeration is group-derived candidates, not authoritative; no direct Confluence license endpoint |
| **JSM** | L3 | **DERIVED GO** | Agent seats resolved from `jira-servicedesk` application role groups | No dedicated JSM API; agent identity inferred from role membership |
| **JPD** | L4 | **UNKNOWN** | Plan status visible via instance/license; no JPD-specific seat API | No JPD seat enumeration or savings claims possible with current APIs |

## 9. What remains UNKNOWN until live verification

The following items cannot be verified without authenticated Forge credentials and a real Jira/Confluence site:

1. **`/rest/api/3/users` under Forge `asApp()` identity:** The documentation says "Connect apps cannot access this REST resource" but provides a Forge code example. Live verification must confirm the endpoint serves under Forge app identity and that `emailAddress` is returned (privacy controls may suppress it).

2. **`read:jira-work` scope for `/rest/api/3/search/jql`:** The enhanced search endpoint lists `read:jira-work` as the classic scope. Live verification must confirm this scope is accepted by the endpoint under an installed app identity.

3. **`read:avatar:jira` necessity:** Listed in scope requirements for `/rest/api/3/users` and `/rest/api/3/group/member`, but Atlas consumes none of the avatar subfields. VERIFY-LIVE: if both endpoints serve without `read:avatar:jira`, REMOVE the scope (least privilege; addendum A7).

4. **Confluence `/wiki/rest/api/group` totalSize:** The group listing response has no reliable `totalSize`. Live verification must confirm whether the absence is consistent.

5. **Forge storage (KVS) concurrency semantics:** Atlas uses KVS for scan lease/checkpoint. Best-effort lease cannot be called race-proof until live Forge concurrency is observed.

6. **Real pagination shapes under large tenants:** Fixture pagination covers offset and token patterns, but live endpoints may have edge cases (empty pages, total-count clamping, continuation behavior at boundary) not visible in small test tenants.

7. **`/rest/api/3/instance/license` and `/rest/api/3/license/approximateLicenseCount` behavior:** Both marked Experimental. Live verification must confirm they serve and return expected shapes.

## 10. What is explicitly NOT in V1 scope

The following are NOT accessed by Atlas V1:

- **Audit logs** (`read:audit-log:jira`) — zero-use test (SEC-2); weak signal for renewal savings.
- **Email addresses** (`read:email-address:jira`) — not needed; local-part hint from profile suffices.
- **Admin endpoints** (`manage:jira-configuration`) — Atlas never writes configuration.
- **Write operations** of any kind — V1 is entirely read-only.
- **Jira v2 API** (`/rest/api/2/...`) — Atlas uses v3 paths per Forge lint requirements.
- **Confluence v2 API** (`/wiki/api/v2/...`) — Atlas uses v1 wiki REST paths for Forge compatibility.
- **Organization Admin API** (`api.atlassian.com/admin/v1/...`) — compiled but disabled; not declared as manifest remote.
- **Webhooks, Connect apps, OAuth 3LO flows** — Forge-only identity model.
- **Data Center / Server APIs** — Cloud-only product.

## 11. Adapter contract

Both gateway implementations (`ForgeAtlassianGateway`, `FixtureAtlassianGateway`) implement the same `AtlassianGateway` interface. All responses are parsed through shared adapters in `src/gateway/adapters.ts`. Inline parsing in a transport is a parity violation by construction (FORGE_PARITY_MODE adapter rule, functional BLOCKER 1, SEC-M3).

Key adapter rules:
- Malformed/unknown fields preserved as null (ERR-6) — never coerced to activity-absent.
- `emailHint()` extracts lowercased local-part only (SEC-3/SEC-L2).
- `parseWireConfluenceMemberItem` handles both `account.accountId` and inline `accountId` shapes.
- `parseWireContributionItem` preserves `version.when` timestamp (functional BLOCKER 1).
- `adaptOutcome` maps HTTP status codes to `GatewayOutcome` with `PERMISSION_DEGRADED`, `RATE_LIMITED_EXHAUSTED`, etc.

## 12. Rate limits and throttling

Atlassian documentation states that rate limits are applied per-app and per-tenant. The exact limits are not publicly documented with specific numbers. Atlas handles this via:

- Centralized pacing policy (section 5.3).
- `Retry-After` header honored as minimum delay floor.
- `x-ratelimit-remaining` and `ratelimit-reason` headers surfaced in telemetry.
- Best-effort scan lease via KVS to prevent concurrent scans within the same tenant.
- Partial scan remains visibly partial (never labeled complete when rate-limited).

## 13. Known risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `emailAddress` hidden by privacy settings under Forge identity | MEDIUM | Local-part hint is best-effort; service-account heuristic still works; missing email → null, never fabricated |
| `totalSize` unreliable on Confluence group listing | LOW | Surfaces `meta.total = null` as degraded field; downstream treats as INCOMPLETE |
| Experimental endpoints (license, instance) may change or disappear | LOW | Tolerated absent via 404/malformed handling; not used for critical classification |
| `read:avatar:jira` may not be required | LOW | VERIFY-LIVE drop condition recorded (addendum A7); zero-consumption scopes dropped per SEC-2 |
| `read:jira-work` scope exact acceptance | MEDIUM | VERIFY-LIVE: confirm scope string accepted by enhanced search under installed app identity |
| Large-tenant pagination edge cases | MEDIUM | Untested under real scale; partial scan safety + `isLast=null` UNKNOWN treatment prevents false completeness |
| KVS concurrent scan lease | LOW | Best-effort only; not race-proof until live Forge concurrency observed |

---

*This document was created by `api_architect` on 2026-08-27 by verifying official Atlassian documentation at developer.atlassian.com and cross-referencing the actual gateway implementation in `src/gateway/forge/forgeGateway.ts`, `src/gateway/fixture/fixtureGateway.ts`, `src/gateway/adapters.ts`, `src/gateway/pacing.ts`, `src/gateway/types.ts`, and `manifest.yml`.*
