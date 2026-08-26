# ATLAS — BINDING API FEASIBILITY MAP

Status: **BINDING FOR IMPLEMENTATION** — canonical input for Builder alongside `docs/PRODUCT_V1.md` and `docs/SECURITY_TEST_PLAN.md`.
Lane: `api_architect` (ACTIVE_PRIMARY, FEASIBILITY). Output file owned by this card.
Verified: **2026-08-26** against current official Atlassian developer documentation fetched live from `developer.atlassian.com` (see §12 Provenance).

Product truth rule: anything marked **UNKNOWN**, **DEGRADED**, or **VERIFY-LIVE** stays that way until real evidence replaces it. Missing evidence is never SAFE. This map controls platform facts; where it conflicts with product wishes, this map wins on feasibility and security wins on safety.

---

## 1. Executive verdict

| # | Capability | Verdict | Basis |
|---|---|---|---|
| 1 | Forge as V1 platform | **GO** | Current runtime supports Node.js 22/24; Connect is closed to new Marketplace submissions (Forge-only since Sep 2025) |
| 2 | Parity gate requirement `nodejs24.x` | **GO** | Official runtime docs list `nodejs24.x` as supported |
| 3 | Jira inventory (users, groups, membership) | **GO** | REST v3 paginated users/groups endpoints, Forge-callable |
| 4 | Jira paid-seat mapping (who holds which product seat) | **GO** | `GET /rest/api/3/applicationrole`: per-role groups + groupIds, `userCount`, `numberOfSeats`, `remainingSeats`; Administer Jira required |
| 5 | Jira/JSM/JPD plan detection (PAID/FREE) | **GO (Experimental)** | `GET /rest/api/3/instance/license` returns `applications[] {id, plan}`; experimental — tolerate absence |
| 6 | Approximate seat counts per product | **GO (Experimental)** | `GET /rest/api/3/license/approximateLicenseCount[/product/{key}]`; Administer Jira; 7-day cache staleness must be surfaced in UI |
| 7 | Jira per-user last-active via product REST | **BLOCKED (direct)** | No documented per-user last-login/last-active field exists in Jira REST v3. Use contribution signals (§4) and/or Org Admin enrichment (row 8) |
| 8 | Org Admin REST enrichment (`api.atlassian.com/admin/v1`) | **GO WITH CONSTRAINTS (optional)** | Per-user per-product `last_active` + `access_billable`; customer-created org API key (Bearer), NOT part of Forge install flow; egress remote declaration required |
| 9 | Confluence inventory (users, groups) | **GO (partial)** | v1 user/group endpoints Forge-callable; group listing paginates without reliable `totalSize`; no Confluence application-role equivalent verified (**UNKNOWN**) |
| 10 | Confluence per-user last-seen via REST | **BLOCKED (direct)** | Current CQL field reference has no `lastseen`; `/wiki/rest/api/search/user` accepts only user-identity fields (`user`, `user.fullname`, `user.accountid`, `user.userkey`) |
| 11 | Confluence contribution activity evidence | **GO** | Content search CQL fields `creator`, `contributor`, `LastModified` are current and documented |
| 12 | JSM agent-seat identification | **GO (derived)** | Agents surface as Jira application role `jira-servicedesk` groups + counts; servicedeskapi callable from Forge apps |
| 13 | JPD contributor-seat identification via product REST | **UNKNOWN** | Ideas are queryable as Jira issues; no public REST found for views/contributor seats. Only plan status (row 5) is defensible today |
| 14 | Atlas self-license detection (free/paid/trial) | **GO** | License API `GET /forge/app/v1/license`; needs `licensing.enabled: true`; rate limit 1 req/5 min/installationId, 10/min/tenant |
| 15 | Exact customer billing/pricing data via API | **BLOCKED** | No public API exposes customer invoices/tier pricing. Estimates only, from versioned price tables (§6) |
| 16 | Scan execution inside Forge limits | **GO with constraints** | 25 s user-led invocations vs up to 900 s scheduled/async functions; chunked checkpointed scan mandatory (§7) |
| 17 | Login events via product REST | **BLOCKED** | Login events are documented under Org Admin events API and require Atlassian Guard; never assume availability |

**Overall: no fundamental blocker to a read-only money-first V1.** The honest evidence model is:

- Seats & plans: strong (Jira application roles + license metrics + Org API enrichment).
- Inactivity evidence: strongest via Org Admin `last_active` when the customer connects an org API key; otherwise contribution-based signals with explicit confidence labels.
- Money precision: estimate-only by design; exact billing is impossible for any Marketplace app.

---

## 2. Forge platform facts (verified 2026-08-26)

### 2.1 Runtime

- Supported runtimes: `nodejs22.x`, `nodejs24.x` (`nodejs20.x` EOL 2026-04-30 but still available). Parity gate's `nodejs24.x` requirement is valid.
- Memory: default 512 MB, max 1024 MB per invocation via `runtime.memoryMB`. Ephemeral `/tmp`: 512 MB, guaranteed only within a single invocation. Tenant data must never persist in globals or `/tmp` across invocations.
- Legacy sandbox runtime is fully deprecated; all new apps use the native Node runtime.

### 2.2 Invocation limits (binding for scan design)

| Resource | Limit |
|---|---|
| User-led function runtime | 25 s hard stop |
| Web-trigger/action module runtime | 55 s |
| Async-event & scheduled-trigger function runtime | up to 900 s (default 55 s; extend via `timeoutSeconds`) |
| Single outbound request timeout (async) | 180 s |
| Invocation rate (per user / per install / per app, per minute) | 1,200 / 5,000 / 30,000 |
| Network requests (incl. requestJira/requestConfluence) | 3M/min per app; 100k/min per app per tenant |
| Egress requests (external fetches, excl. product APIs) | 100 per runtime-minute per invocation (scales with `timeoutSeconds`); 50k/min per app |
| Invocation payload | 5 MB request; front-end invoke response ≤ 5 MB; front-end invoke request ≤ 500 KB |
| Logs | 100 lines per runtime-minute (rounded up); 200 KB per invocation |

Consequence: **a full-environment scan cannot run inside one UI invocation.** See §7.

### 2.3 Scheduled triggers

- Max **5** scheduled trigger modules per app; only **one** may use the `fiveMinute` interval.
- Scheduled-trigger functions share async-event limits (900 s max runtime).

### 2.4 Storage (KVS / Custom Entity Store)

Per installation: 1,000 RPS; reads 4,000 × 10 KB-rounded requests/min; writes 4,000/min. Value ≤ **240 KiB** raw; key ≤ 500 chars; object depth ≤ 31. Transactions ≤ 25 ops, ≤ 4 MB payload. Custom entities: ≤ 20 entities/app, ≤ 7 indexes, ≤ 50 attributes each. Batch writes count rounded sizes once — prefer batches.

Consequences:
- Per-user records must stay small (store derived evidence, not raw payloads).
- A 10k-user tenant ⇒ ~2,400 KiB minimum for user records alone — fits, but checkpoint state must be compact (cursor pointers, not datasets).
- Secrets belong in encrypted environment variables or `kvs.setSecret`, never plain values (parity gate also scans the repo for org-API-key-shaped literals).

### 2.5 Product REST transport (`@forge/api`)

- `requestJira`, `requestConfluence`, plus JSM servicedeskapi, Bitbucket, GraphQL gateway (`requestGraph`) are available to Forge functions with declared scopes.
- `asUser()` returns 401 for operations that don't support OAuth-user context; `asApp()` uses app identity.
- **`forge lint` accepts only `/rest/api/3` paths for Jira through the Forge proxy.** v2 paths are not lintable — Atlas MUST use REST v3 exclusively for Jira. Confluence v1 `/wiki/rest/api/*` remains standard for user/group surfaces (v2 has no full replacement for these).
- Exact `asApp()` permission semantics per endpoint are **VERIFY-LIVE**: docs state "Permissions required" without always distinguishing app vs user identity. The gateway must make identity mode configurable per call (default `asApp`, fallback `asUser` during interactive admin sessions) so live testing can settle it without redesign.

### 2.6 Forge License API (Atlas self-license)

- `asApp().requestAtlassian('/forge/app/v1/license')`; manifest needs `licensing.enabled: true`.
- Returns `active`, `type` ("commercial"|null), `isEvaluation`, `trialEndDate`, `subscriptionEndDate`, `billingPeriod`, `capabilitySet`.
- Rate limit: **1 request / 5 minutes per installationId**, 10/min per tenant; honor `Retry-After`; cache ~1 h.

### 2.7 Egress

External fetches require declared remote domains in the manifest. If Atlas supports Org Admin enrichment, `api.atlassian.com` must be the only added remote. No other egress belongs in V1 (constitution: no external SaaS/LLM dependencies).

---

## 3. Product coverage map — endpoints Atlas may rely on

All scopes listed are **granular OAuth 2.0 / Forge scope names** as printed in current endpoint docs. Classic equivalents exist but granular names are preferred for least privilege.

### 3.1 Jira (GO)

| Purpose | Endpoint | Scopes (granular) | Notes |
|---|---|---|---|
| Product plans PAID/FREE | `GET /rest/api/3/instance/license` | `read:license:jira` | Experimental; returns `applications[] {id, plan}` incl. `jira-software`, `jira-servicedesk`, `jira-product-discovery`, `jira-core` |
| Total + per-product approximate seats | `GET /rest/api/3/license/approximateLicenseCount`, `.../product/{applicationKey}` | `read:license:jira` | Administer Jira; cached up to 7 days — label as approximate in UI |
| Seat-holding groups per product | `GET /rest/api/3/applicationrole[/\{key\}]` | `read:application-role:jira` | Administer Jira; returns `groups[]`, `groupDetails[] {groupId,name}`, `userCount`, `numberOfSeats`, `remainingSeats`, `hasUnlimitedSeats`. Connect apps cannot access this resource; Forge can |
| All users (paginated) | `GET /rest/api/3/users` | `read:jira-user` classic / user-read granulars | Default page size ~50; limits change without notice — always honor returned `maxResults`; includes `active` flag |
| Bulk user lookup by accountId | `GET /rest/api/3/user/bulk` (Experimental) | `read:user:jira`, `read:group:jira`, `read:application-role:jira`, `read:avatar:jira` | Paginated |
| Groups list | `GET /rest/api/3/group/bulk` (Experimental) | `read:group:jira` | Browse users and groups permission |
| Group members | `GET /rest/api/3/group/member` | `read:group:jira`, `read:user:jira`, `read:avatar:jira` | `includeInactiveUsers` supported; paginated |
| User's groups | `GET /rest/api/3/user/groups` | `read:user:jira` | For redundant-access detection |
| User-management audit events | `GET /rest/api/3/auditing/record?from&to&filter&offset&limit` | `read:audit-log:jira`, `read:user:jira` | Administer Jira; categories include "user management" (e.g., group membership changes). NOT a login feed |

Binding rules for Builder:
1. Never hard-code standard group names (`jira-software-users`, etc.) — current docs explicitly warn these defaults are renameable/deletable. Always resolve seat groups from `applicationrole`.
2. Treat experimental license-metrics responses as optional data: absent/failed ⇒ seat counts become UNKNOWN in UI, never zero.
3. Pagination: use offset pagination (`startAt`/`maxResults`) and stop when `isLast`/short-page semantics indicate end; re-check totals on retry after 429.

### 3.2 Confluence (partial GO)

| Purpose | Endpoint | Scopes (granular) | Notes |
|---|---|---|---|
| Single user by accountId | `GET /wiki/rest/api/user` | `read:content-details:confluence` (per current doc) | Profile fields may be null per privacy settings |
| Bulk users by ids | `GET /wiki/rest/api/user/bulk`; v2 `POST /wiki/api/v2/users-bulk` | `read:content-details:confluence` / `read:user:confluence` | Paginated |
| User's groups | `GET /wiki/rest/api/user/memberof` | `read:user:confluence`, `read:group:confluence` | |
| List groups | `GET /wiki/rest/api/group` (+ group member subresource) | group-read scope (`READ`) | start/limit pagination; no reliable `totalSize` |
| User search | `GET /wiki/rest/api/search/user` | `read:content-details:confluence` | Only identity CQL fields allowed; has undocumented-semantics param `sitePermissionTypeFilter` (**UNKNOWN** semantics — do not build on it without live proof) |
| Content contribution evidence | `GET /wiki/rest/api/search?cql=creator=… / contributor=… AND lastmodified>=…` | classic `search:confluence` / granular `read:content-details:confluence` | The only documented per-user activity proxy inside Confluence REST |

Binding rules:
1. No direct last-seen exists — any Confluence "inactive" claim must be phrased as "no content contributions observed in N days", confidence-labeled, never SAFE NOW on that signal alone.
2. Confluence paid-seat enumeration is **DEGRADED** without Org Admin enrichment: derive candidates from group membership; mark seat status UNKNOWN unless org data or an explicitly verified site-permission filter proves it.
3. Content search results respect viewing permissions of the calling identity — partial visibility must be recorded as partial scan.

### 3.3 Jira Service Management (derived GO)

- Agent seats are represented through Jira application roles (`jira-servicedesk` appears among licensed applications in `instance/license`). Resolve agent groups via `applicationrole/jira-servicedesk`, then members via `group/member`.
- servicedeskapi (`/rest/servicedeskapi/*`) is Forge-callable with granular scopes like `read:servicedesk:jira-service-management`, `read:user:jira`. V1 does not need customer/org endpoints for savings logic; treat them out of scope to minimize consent surface.
- Customers hold free portal access — never counted as billable seats.

### 3.4 Jira Product Discovery (UNKNOWN beyond plan status)

- Ideas are Jira issues: queryable via Jira REST v3 where the app's permissions allow.
- Plan detection via `instance/license` (`jira-product-discovery` FREE/PAID): GO.
- Contributor ("paid creator") seat enumeration: no public REST found → **UNKNOWN**. V1 may show JPD plan status and issue-level contributor evidence but MUST NOT claim seat counts. Any JPD savings figure requires org-API `product_access` data or remains REVIEW/UNKNOWN.
- Parity fixtures: keep a JPD creator-like case marked UNKNOWN-evidence so downstream code handles it honestly (per FORGE_PARITY_MODE).

### 3.5 Organization Administration REST (optional enrichment — constrained GO)

Base: `https://api.atlassian.com/admin/v1|v2/orgs/{orgId}/...`

| Data | Endpoint | Auth |
|---|---|---|
| Org users w/ `access_billable`, `last_active`, `product_access[].last_active` | `GET /admin/v1/orgs/{orgId}/users` (cursor-paginated) | Bearer org API key; scope `read:accounts:admin` |
| Per-user last active dates per product + `added_to_org` | `GET /admin/v1/orgs/{orgId}/directory/users/{accountId}/last-active-dates` | Bearer org API key |
| Login events | `GET /admin/v1/orgs/{orgId}/events?action=login` | Requires Atlassian Guard — treat as unavailable by default |

Facts that shape design:
- "Active" = viewing a product page ≥ 2 s; data delayed up to 24 h; empty `product_access` = never accessed.
- Auth uses an **org API key created manually by the customer's org admin** (Settings › API keys; max 1-year expiry). This is outside Forge install consent: it is an explicit, optional, revocable configuration step, not a silent capability.
- The legacy `GET .../users` variant is deprecated (sunset June 2027) in favor of the newer user-search flow — implement against the current paginated shape and isolate the call behind the gateway so a future swap is one adapter file.
- Constraints (binding):
  1. Feature-flagged OFF until security architect approves secret storage design (key stored via `kvs.setSecret`/encrypted env only; never logged; parity gate already greps for key-shaped literals).
  2. Manifest declares exactly one extra remote: `api.atlassian.com`.
  3. UI must label scans using org data distinctly (stronger evidence class) from contribution-only inference.
  4. Absence of org key ⇒ product still fully functional with degraded confidence labels.

---

## 4. Activity-evidence strategy (what each signal may prove)

| Signal | Source | Proves | Never proves |
|---|---|---|---|
| `last_active` per product | Org Admin API | User has/hasn't used a product recently; strongest inactivity evidence available | Intent to return, shared-account usage by another human |
| Issue authorship/assignment/comment/worklog recency | Jira search + issue fields | Contribution activity inside Jira | Read-only usage; admin/marketplace usage |
| Confluence `contributor`/`creator` CQL recency | Content search | Write activity inside Confluence | Page views, comment-only or read-only use |
| Group membership overlap | applicationrole + group/member | Redundant multi-group seat derivation paths | Actual login/usage |
| Audit records (`auditing/record`) | Jira REST | Account lifecycle events (created/deactivated/group changes) | Logins, content usage |
| `active` flag on user objects | users endpoints | Deactivated status (already non-billable candidates differ) | Anything about active users |

Risk-classification consequence (binds the risk engine):
- SAFE NOW requires org-API last-active evidence **or** ≥2 independent product signals of long inactivity plus no admin/service-account markers — never a single missing field.
- Missing activity data ⇒ UNKNOWN, per parity rule 9. Inactivity windows (30/60/90/180) are observation facts, not verdicts.

---

## 5. Rate limiting & error semantics (verified)

- Jira Cloud and Confluence both use a **points-based model** (base cost per request + object costs; e.g., Users = 2 points) with hourly app quotas, plus burst buckets (~100 GET/s default). Beta headers (`Beta-RateLimit-*`, `Beta-Retry-After`) signal upcoming quota enforcement.
- On breach: HTTP 429 with `Retry-After` (+ `X-RateLimit-Limit/Remaining/Reset`, `RateLimit-Reason` like `jira-quota-global-based`, `jira-burst-based`). Headers are not guaranteed present on every response.
- Forge License API: 1 req/5 min/installationId, 10/min/tenant, `Retry-After` honored.
- Required gateway behavior (tests must cover): respect `Retry-After` as minimum delay; exponential backoff with jitter (0.7–1.3×); cap retries (≤4) then mark checkpoint failed-not-fatal; treat 401/403 as permission-partial (record missing capability, continue other products); 5xx retryable only when idempotent GET; never convert an incomplete scan into "complete".

---

## 6. Pricing & billing boundary

1. No Atlassian API exposes customer invoices, discounts, tier thresholds, or negotiated pricing to Marketplace apps. Any claim of exact billing is fabrication.
2. Atlas financial engine MUST consume a versioned, testable price table (list prices incl. tier bands, minimums, per-product monthly/annual distinctions) and output labeled estimates with visible assumptions.
3. Seat counts feeding the estimate come from: exact membership counts where derivable (application-role groups), cross-checked against approximate license counts (7-day staleness disclosed).
4. Renewal framing uses optional customer-provided renewal date; nothing in the API supplies it.

---

## 7. Scan orchestration constraints (derived from verified limits)

- UI "Run scan" starts a scan job: writes intent to KVS, schedules chunk work via scheduled-trigger function (900 s budget) or async-event queue; UI polls status via resolver invocations (25 s budget each).
- Checkpoint record per product stream (Jira users page N, group G member offset M, Confluence cursor C, org-users cursor O) — cursors only, not datasets.
- Per-invocation request budget: stay well under 100k/min/app/tenant network ceiling; pace with jittered delays; abort-and-resume cleanly across 429s.
- Partial-scan state machine states: `QUEUED → RUNNING(product×chunk) → DEGRADED(capability, reason) → COMPLETE(partial flags)`; persisted result carries per-stream completeness so UI can show "partial" honestly (parity rules 8–9).
- Fixture mode exercises the identical state machine through `FixtureAtlassianGateway`; fixture responses must reproduce envelope shapes including pagination headers/links, 429-with-Retry-After, 403, and malformed fields (FORGE_PARITY_MODE §Required test fixtures).

---

## 8. Gateway adapter contract (binding interface)

Location: `src/gateway/` (Builder may adjust names, not the contract shape).

```ts
// Identity mode is explicit; live verification (§11) settles per-endpoint behavior.
type Identity = { mode: "asApp" } | { mode: "asUser"; accountId?: string };

interface AtlassianGateway {
  // --- inventory ---
  listJiraApplicationRoles(): Promise<ApplicationRole[]>;            // /rest/api/3/applicationrole
  getInstanceLicensePlans(): Promise<ProductPlan[] | null>;          // /rest/api/3/instance/license (nullable: experimental)
  getApproximateLicenseCount(productKey?: string): Promise<SeatCount | null>;
  listJiraUsers(cursor: PageCursor): Promise<Page<JiraUser>>;
  listGroups(cursor: PageCursor): Promise<Page<Group>>;
  listGroupMembers(groupId: string, cursor: PageCursor): Promise<Page<JiraUser>>;
  listUserGroups(accountId: string): Promise<GroupRef[]>;
  listConfluenceUsersBulk(accountIds: string[]): Promise<ConfluenceUser[]>;
  listConfluenceGroups(cursor: PageCursor): Promise<Page<Group>>;
  listConfluenceGroupMembers(group, cursor): Promise<Page<ConfluenceUser>>;
  searchConfluenceContributions(cql: string, cursor: PageCursor): Promise<Page<ContentHit>>;

  // --- optional enrichment (org API key configured) ---
  orgConfigured(): boolean;
  listOrgUsers(cursor: Cursor): Promise<Page<OrgUser>>;              // access_billable, last_active, product_access
  getOrgLastActiveDates(accountId: string): Promise<OrgLastActive>;

  // --- app self-license ---
  getAppLicense(): Promise<AppLicense>;                              // cached ≥1h inside gateway

  // --- transport discipline ---
  request(req: GatewayRequest): Promise<GatewayResponse>;            // applies retry/backoff/pacing policy centrally
}

type GatewayEnvelopeMeta = {
  pagination: { cursor?: string; next?: string; total?: number | null; pageSize: number };
  rateLimit?: { retryAfterSec?: number; remaining?: number; reason?: string };
  degradedFields?: string[];   // fields absent/unknown in this response
};
```

Rules:
1. Everything downstream (normalization → evidence → risk → finance → recommendations → UI models) imports ONLY this interface — never `@forge/api` directly.
2. `FixtureAtlassianGateway` implements the same interface with deterministic data and identical envelope metadata (including error envelopes); fixture runs are visibly labeled in UI/log/state (`dataMode: "fixture"`).
3. Every call result records `{endpoint, status, degradedFields, attemptCount}` into scan telemetry so partial scans are auditable.
4. No endpoint outside §3's tables may be called without a new feasibility entry.

### Manifest scope set (least privilege, granular)

```yaml
permissions:
  scopes:
    - read:license:jira
    - read:application-role:jira
    - read:user:jira
    - read:group:jira
    - read:avatar:jira
    - read:audit-log:jira        # only if audit evidence stream implemented in V1
    - read:content-details:confluence
    - read:user:confluence
    - read:group:confluence
  # egress:
  #   remote:
  #     - api.atlassian.com       # ONLY if org-API enrichment ships
```

No write scopes. No admin-scopes beyond the reads above. If a scope proves unused by shipped code, delete it (parity rule 2).

### Modules

- `jira:adminPage` (works in Jira + JSM): money-first dashboard + Configure (`useAsConfig`) + Get started (`useAsGetStarted`). Subpages require Custom UI.
- `scheduledTrigger`: exactly one, for scan chunks/rescans (≤5 modules/app constraint leaves room for one more if needed later).
- Runtime block: `name: nodejs24.x`, `memoryMB` up to 1024 if needed.

---

## 9. Open risks & live-verification checklist (cannot be closed in parity mode)

| # | Unknown | Why it matters | Live test when credentials exist |
|---|---|---|---|
| L1 | `asApp()` acceptance for applicationrole/license-metrics/auditing on real tenants | Determines whether scans need an admin user-context session | Call each asApp with admin-installed app; record statuses |
| L2 | Experimental endpoints' stability/shape drift | instance/license & approximateLicenseCount are experimental | Snapshot responses; add tolerant parsers |
| L3 | Confluence seat enumeration without org key | Affects Confluence savings confidence labels | Compare group-derived candidates vs org `access_billable` |
| L4 | `sitePermissionTypeFilter` semantics on `/search/user` | Could enumerate licensed users cheaply | Probe with admin token; document or drop |
| J5 | JPD contributor seats | JPD savings claims | Check org product_access for jira-product-discovery keys |
| L6 | Org API key UX viability & Guard-gated events | Enrichment rollout friction | Install flow trial with test org |
| L7 | Points-cost of scan pattern under hourly quota | Scan duration for large tenants | Measure quota headers during a full run |

---

## 10. Direct implementation constraints summary (for Builder)

1. Jira REST v3 only via `requestJira` (forge-lint restriction). Confluence v1 wiki paths via `requestConfluence`.
2. Resolve seat groups from `applicationrole`; never from hard-coded group names.
3. All paginated loops honor returned page sizes and stop conditions; totals nullable.
4. Experimental license metrics ⇒ optional data path with UNKNOWN fallbacks.
5. Scan engine = checkpointed state machine across scheduled-trigger invocations (§7); never one-shot.
6. Retry/backoff/jitter + Retry-After centralized in gateway (§5); tests must simulate 401/403/404/429/5xx/malformed.
7. Estimates-only finance; versioned price tables; disclose approximation windows (§6).
8. Evidence classes labeled per §4; missing activity ⇒ UNKNOWN; SAFE NOW needs strong-signal rules.
9. Org-API enrichment behind feature flag + single declared remote + secret-safe storage (§3.5).
10. Self-license gating uses Forge License API with ≥1 h cache (§2.6).

## 11. Feasibility status for parity fixtures

Fixture set required by FORGE_PARITY_MODE maps to feasibility as follows — include all, with honest states:

active user · 30/60/90/180-day inactive (org last_active AND contribution-only variants) · never-active · admin (application-role marker) · service-account heuristic (no human activity, bot-like name/email patterns — REVIEW class) · single-group seat · multi-group redundancy · Jira-only vs Confluence-only evidence · JSM agent-like case (jira-servicedesk role) · JPD creator-like case (**UNKNOWN** seat status) · missing/unknown activity · insufficient permissions (403 per product) · pagination (incl. changed page size mid-loop) · rate limit then recovery (Retry-After honored) · partial scan failure (one stream DEGRADED) · tier/pricing boundary cases.

## 12. Provenance (official sources fetched 2026-08-26)

- Forge Node.js runtime (22/24 supported): developer.atlassian.com/platform/forge/function-reference/nodejs-runtime
- Forge invocation limits: developer.atlassian.com/platform/forge/limits-invocation/
- Scheduled trigger limits: developer.atlassian.com/platform/forge/limits-scheduled-trigger/
- KVS/entity store limits: developer.atlassian.com/platform/forge/limits-kvs-ce/
- Platform limits overview (consumption pricing since 2026-01-01): developer.atlassian.com/platform/forge/platform-quotas-and-limits/
- Product REST APIs from Forge (requestJira/…; `/rest/api/3` lint rule): developer.atlassian.com/platform/forge/apis-reference/product-rest-api-reference/
- Forge License API: developer.atlassian.com/platform/forge/apis-reference/license-api/
- Jira REST v3 — Application roles: …/rest/v3/api-group-application-roles/
- License metrics (instance/license, approximateLicenseCount): …/rest/v3/api-group-license-metrics/
- Audit records: …/rest/v3/api-group-audit-records
- Users / User search / Groups: …/rest/v3/api-group-users/, …/api-group-user-search/, …/api-group-groups/
- Jira rate limiting (points model): developer.atlassian.com/cloud/jira/platform/rate-limiting/
- Confluence CQL field reference (no lastseen; user-field split): developer.atlassian.com/cloud/confluence/advanced-searching-using-cql
- Confluence search deprecation (/search/user identity-only): developer.atlassian.com/cloud/confluence/deprecation-notice-search-api/
- Confluence Users/Group/Search groups (v1): …/cloud/confluence/rest/v1/api-group-users/, api-group-group/, api-group-search/
- Confluence v2 users-bulk: …/cloud/confluence/rest/v2/api-group-user/
- Confluence rate limiting: developer.atlassian.com/cloud/confluence/rate-limiting/
- JSM REST (scopes, servicedeskapi): developer.atlassian.com/cloud/jira/service-desk/rest/
- Org Admin REST (users w/ access_billable+last_active; last-active-dates; API-key Bearer auth; users deprecation 2027-06-30): developer.atlassian.com/cloud/admin/organization/rest/api-group-users/, /user-last-active-dates, /rest/intro
- Connect→Forge Marketplace cutoff: developer.atlassian.com/cloud/jira/software/forge/
- jira:adminPage module: developer.atlassian.com/platform/forge/manifest-reference/modules/jira-admin-page/

Community threads consulted only for risk context (never as API truth): Node24 CLI compatibility, audit-record pagination, Confluence group totalSize gap.

— End of binding map. Changes require a new `api_architect` pass with fresh source verification.
