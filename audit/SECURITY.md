# ATLAS SECURITY RED TEAM — INDEPENDENT AUDIT

**Auditor:** security_redteam  
**Candidate baseline:** Builder working tree at HEAD (main)  
**Date:** 2026-08-27  
**Scope:** Scopes, tenancy, auth, storage, secrets, egress, fixture/live separation, concurrency/state safety, Marketplace trust  
**Do not repair product code.** Only durable write is this file.

---

## Executive Summary

Atlas V1 demonstrates **strong security posture** for a Forge-first read-only product. The codebase implements defense-in-depth across tenancy isolation, secret scrubbing, fixture/live separation, and false-positive elimination. The candidate passes all deterministic security gates (GATE-1 through GATE-15). However, I have identified **3 MEDIUM** and **4 LOW** findings that require honest acknowledgment before MARKETPLACE_READY. No BLOCKER or HIGH findings exist.

| Severity | Count | Status |
|----------|-------|--------|
| BLOCKER | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 3 | Requires attention before live |
| LOW | 4 | Known residuals, tracked |

---

## MEDIUM Findings

### SEC-R1: Org-admin Bearer token not scrubbed from fetch() request headers

**Severity:** MEDIUM  
**Category:** Secrets management  
**File:** `src/gateway/forge/forgeGateway.ts:507`  
**Evidence:**

```typescript
headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
```

The `listOrgUsers` method constructs a Bearer authorization header from the `apiKey` obtained via `orgEnrichment.getApiKey()`. While this path is **feature-flagged OFF by default** (`orgEnrichment.enabled: false`), the code path exists and compiles. If ever enabled, the Bearer token would be passed through the Forge transport layer's `pacedRequest`, which calls `transport.request(req)`. The Forge transport (`defaultForgeTransport`) passes headers to `fetch()` for absolute URLs:

```typescript
response = await fetch(req.absoluteUrl, {
  method: req.method,
  headers: req.headers ?? {},
  ...
});
```

The logger's `scrubValue` function redacts bearer-shaped values in meta objects, but the token is constructed inline in the `headers` object of the request, not in a logged meta field. If any telemetry or error path logs the request headers, the token could leak.

**Impact:** If org-admin enrichment is enabled, the Bearer token could appear in error logs or telemetry if the request fails at the transport level.  
**Reproduction:** Enable orgEnrichment with a test key, trigger a 5xx error, and inspect error logs for the raw header.  
**Mitigation (already present):** The feature is disabled by default. The API key is fetched async and held transiently. The manifest does not declare `api.atlassian.com` as a remote.  
**Recommendation:** Before enabling org-admin enrichment, add explicit header scrubbing to the `pacedRequest` error paths, or use a Forge-managed auth mechanism instead of raw fetch.

---

### SEC-R2: Scan lease is best-effort, not race-proof

**Severity:** MEDIUM  
**Category:** Concurrency/state safety  
**File:** `src/backend/scanService.ts:453-477`  
**Evidence:**

```typescript
if (
  rec.leaseUntilEpochMs !== null &&
  rec.leaseUntilEpochMs > now &&
  rec.leaseOwnerToken !== this.leaseToken
) {
  this.log(`chunk skipped: scan ${rec.scanId} leased by another invocation until ...`);
  return rec;
}
```

The lease is acquired by reading the record from KVS, checking the lease fields, and then persisting the record with the new lease. Between the read and the persist, another invocation could read the same stale record and both proceed to advance the scan. Forge KVS does not provide CAS (compare-and-swap) semantics.

**Impact:** Under concurrent invocations (e.g., resolver + scheduled trigger overlapping), two chunks could both read the same cursor, both append the same page of data, and both persist. This could result in duplicate rows in the acquisition lists, inflating user counts and potentially causing incorrect savings estimates.  
**Reproduction:** Run two `runChunk` calls simultaneously against the same storage backend with overlapping lease windows. The test `scan-lease.test.ts` SEC-H2 tests the happy path but cannot prove mutual exclusion under real KVS concurrency.  
**Mitigation (already present):** The lease narrows the window to the read-persist gap. Terminal states release the lease. Expired leases are taken over.  
**Residual:** Documented in `docs/RELEASE_STATUS.md` and `docs/SECURITY_TEST_PLAN.md` RES-6/RES-9. Must be settled with live Forge KVS semantics.

---

### SEC-R3: CQL injection surface in Confluence contribution search

**Severity:** MEDIUM  
**Category:** Input validation  
**File:** `src/gateway/forge/forgeGateway.ts:440`  
**Evidence:**

```typescript
const cql = `contributor="accountid:${cqlAccountId}" and lastmodified>="${windowStartIso.slice(0, 10)}" order by lastmodified desc`;
```

The `cqlAccountId` parameter is interpolated directly into a CQL query string. If an attacker could control the `accountId` value (e.g., by creating a malicious account with a crafted `accountId` containing CQL special characters like `"`, `and`, or `order by`), they could inject CQL predicates.

**Mitigating factors:**
1. `cqlAccountId` is derived from server-side Forge context or from previously-fetched user data (via `pendingContributionAccountIds`), not from raw client input.
2. AccountIds in Atlassian Cloud are opaque UUIDs managed by the platform; user-controlled injection is unlikely.
3. The CQL is URL-encoded in the request path.
4. The query is read-only (Confluence search API).

**Impact:** Low practical exploitation likelihood due to platform-managed accountIds, but the code pattern is structurally vulnerable to injection if input assumptions change.  
**Reproduction:** Craft a CQL injection payload as an accountId and observe if it escapes the CQL string. (Not possible with real Atlassian accountIds.)  
**Recommendation:** Validate `cqlAccountId` against a strict UUID/opaque-id regex before interpolation, or use parameterized CQL if the API supports it.

---

## LOW Findings

### SEC-R4: Unnecessary scope `read:avatar:jira` declared but not consumed

**Severity:** LOW  
**Category:** Least privilege  
**File:** `manifest.yml:47`, `src/gateway/types.ts:264-267`  
**Evidence:**

```yaml
- read:avatar:jira
```

The scope budget in `types.ts` marks this scope as `justified` with the note: "feasibility endpoint table lists this scope for /rest/api/3/users and /rest/api/3/group/member; see addendum A7 (VERIFY-LIVE: drop if served without it)". The scope exercises `listJiraUsers` and `listGroupMembers` but Atlas consumes none of the avatar subfields.

**Impact:** Over-privileged scope. The Marketplace review may question why a license optimizer needs avatar access.  
**Reproduction:** Check `SCOPE_BUDGET` in types.ts — the `justified` field explicitly acknowledges the scope is not consumed.  
**Recommendation:** VERIFY-LIVE: if both endpoints serve without `read:avatar:jira`, remove it from the manifest.

---

### SEC-R5: `rescan` endpoint has no rate limiting or confirmation gate

**Severity:** LOW  
**Category:** Abuse/DoS  
**File:** `src/backend/index.ts:96-111`  
**Evidence:**

```typescript
resolver.define('rescan', async ({ context }: { context: ForgeInvocationContext }) => {
  const { service } = buildService(context);
  const current = await service.getCurrentRecord();
  if (current) {
    current.status = 'QUEUED';
    current.report = null;
    current.phase = 'queued';
    current.leaseUntilEpochMs = null;
    current.leaseOwnerToken = null;
  }
  await service.ensureScan();
  await service.runChunk(RESOLVER_CHUNK_BUDGET_MS);
  return publicSnapshot(service);
});
```

The `rescan` endpoint resets the scan to QUEUED and starts a new one. There is no rate limiting, no confirmation prompt, and no cooldown. A malicious admin could repeatedly click "Rescan" to waste Forge compute budget and API rate limits.

**Impact:** Resource exhaustion within the tenant's own Forge function budget. Cannot cross tenant boundaries.  
**Reproduction:** Click "Rescan" button repeatedly in the dashboard.  
**Recommendation:** Add a minimum cooldown between rescans (e.g., 60 seconds), or gate behind a confirmation dialog.

---

### SEC-R6: Branch protection not certified

**Severity:** LOW  
**Category:** Marketplace trust  
**File:** `docs/RELEASE_STATUS.md:84`  
**Evidence:**

```
The repository is public and branch protection has not been certified as active.
```

The repo is public. Without branch protection, any contributor could push directly to `main`, bypassing the release gate pipeline. The factory workflow runs on `main` pushes and scheduled triggers, but a direct push could inject untested code.

**Impact:** Supply chain risk if a contributor is compromised. The factory workflow does run on pushes, but a malicious commit could pass through before detection.  
**Reproduction:** Check GitHub repository settings for branch protection rules on `main`.  
**Recommendation:** Enable branch protection requiring PR review and status checks before merge to `main`.

---

### SEC-R7: `setExceptions` accepts arbitrary string array without strict validation

**Severity:** LOW  
**Category:** Input validation  
**File:** `src/backend/index.ts:132-141`  
**Evidence:**

```typescript
resolver.define('setExceptions', async ({ payload, context }: { payload: any; context: ForgeInvocationContext }) => {
  const { service } = buildService(context);
  const ids = Array.isArray(payload?.exceptionAccountIds)
    ? (payload.exceptionAccountIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128)
    : [];
  const cfg = await service.getRenewalConfig();
  await service.setRenewalConfig({ ...cfg, exceptionAccountIds: [...new Set(ids)] });
  ...
});
```

The exception list accepts any string up to 128 characters. While this is scoped to the tenant's own storage, a malicious payload could flood the exception list with thousands of entries, inflating the stored config. The `Set` deduplication prevents exact duplicates but not unique junk.

**Impact:** Storage bloat within the tenant's own KVS namespace. Cannot cross tenant boundaries.  
**Reproduction:** Call `setExceptions` with 10,000 unique short strings.  
**Recommendation:** Add a maximum count (e.g., 500 exceptions) to bound storage usage.

---

## Passed Areas (No Findings)

### Tenancy Isolation (TEN-1..TEN-5) — PASS
- Server-side tenant derivation from Forge context (installationId preferred).
- Storage keys namespaced with installationId in strict `atlas:v1:<installationId>:<entity>` shape.
- Key components validated against regex with traversal rejection.
- Cross-tenant access structurally impossible through the storage API.

### Secret Scrubbing (LOG-1..LOG-2) — PASS
- Recursive scrubbing of sensitive keys (authorization, cookie, token, api_key, etc.).
- Bearer-shaped string values redacted even under innocent keys.
- Message strings scrubbed identically to meta values (SEC-M1 repair).
- Depth bounds (6 levels) and array bounds (50 items) prevent log flooding.
- installationId allowed in logs (tenant-safe identifier).

### Fixture/Live Separation (FIX-1..FIX-4) — PASS
- Default is LIVE; fixture requires explicit `ATLAS_DATAMode=fixture` opt-in.
- Production entrypoints cannot reach fixture gateway (ADV-3 enforced statically by `scripts/static-gates.mjs`).
- Core modules are free of fixture literals and activation-mode conditionals.
- Dashboard shows unmissable "DEMO DATA / NOT A LIVE SCAN" banner for fixture.
- Export stamps carry dataMode watermark.
- Only two gateway implementations exist (ForgeAtlassianGateway, FixtureAtlassianGateway).

### Export Hygiene (SEC-L1) — PASS
- Spreadsheet-formula injection neutralized in CSV (leading apostrophe for `=`, `+`, `-`, `@`, `\t`).
- Email addresses: local-part only, domain dropped at adapter boundary (SEC-3/SEC-L2).
- Every export carries full honesty block (generated-at, window, dataMode, pricing model version).

### Memory and Resource Budgets (ADV-5) — PASS
- 60k users × 120k issue activity hits stays under 512 MB Forge budget.
- ShardedList stays well under 240 KiB per KVS shard.
- Completion time < 30s, well under 900s async budget.

### Authentication and Authorization — PASS
- Default identity mode is `asApp()` (fail-closed).
- `asUser()` fallback is gated behind `userFallback: true` and only fires after 401.
- 401/403 never retried; classified as permission-degraded.
- No write scopes, no admin scopes.

### Egress and Network — PASS
- No egress remotes declared in manifest for V1.
- All API calls flow through `@forge/api` (requestJira/requestConfluence).
- No external LLM/API dependencies.
- `fetch()` for org-admin is feature-flagged OFF and the remote is undeclared.

### Marketplace Trust — PASS
- App uses pre-registration sentinel ARI (detectable by live gate).
- Licensing enabled for self-license detection.
- Runtime: nodejs24.x, 512 MB, modern UI Kit with resource + render:native.
- Nine verified read-only scopes.
- Static gates enforce scope budget, manifest structure, and purity.

---

## Honest Residuals (UNKNOWN until live evidence)

| ID | Residual | Risk | Required Evidence |
|----|----------|------|-------------------|
| RES-1 | Forge KVS consistency under concurrent put/get | SEC-R2 | Live Forge concurrency test |
| RES-2 | Authenticated Forge registration/lint/deploy/install | Trust | Real Forge CLI run |
| RES-3 | Actual scope acceptance under installed-app identity | Trust | Live install + scope verification |
| RES-4 | Live pagination/continuation shapes | Correctness | Real API responses |
| RES-5 | Tenant-context consistency between resolver and scheduled-trigger | Correctness | Live trigger observation |
| RES-6 | Resolver accessibility for non-admin users | Trust | Live non-admin invocation |
| RES-7 | End-to-end real tenant scan with manual spot checks | Trust | Manual verification |
| RES-8 | Branch protection certification | SEC-R6 | GitHub settings confirmation |
| RES-9 | `read:avatar:jira` necessity | SEC-R4 | Live endpoint verification |

---

## Test Coverage Verification

All security test requirements from `docs/SECURITY_TEST_PLAN.md` are covered by the existing test suite:

| Requirement | Test File | Status |
|-------------|-----------|--------|
| FP-S1..S4, FP-01..FP-28 | false-positive-matrix.test.ts | PASS |
| ORG-M1..M3 | org-evidence.test.ts | PASS |
| TEN-1..TEN-5, ADV-1..2 | isolation.test.ts | PASS |
| SEC-H2..H2d | scan-lease.test.ts | PASS |
| ERR-1..ERR-7 | gateway-pacing-errors.test.ts | PASS |
| LOG-1..LOG-2 | logger-scrub.test.ts | PASS |
| SEC-L1 | export-hygiene.test.ts | PASS |
| FIX-1..FIX-4 | provenance-ui.test.ts | PASS |
| FP-19..FP-23, HIGH-3..5 | false-positive-matrix.test.ts, partial-drain.test.ts, truncation.test.ts | PASS |
| LIVE-SHAPE-1..3 | live-shape-parity.test.ts | PASS |
| ADV-5, ADV-5b | memory-ceiling.test.ts | PASS |
| FP-24..FP-25, AC4-B/NB, AC12 | pricing.golden.test.ts | PASS |

---

## Conclusion

The Atlas V1 candidate baseline demonstrates **mature security engineering** for a Forge-first read-only product. The three MEDIUM findings (SEC-R1 through SEC-R3) are either feature-flagged OFF or have strong mitigating factors. The four LOW findings are honest residuals that should be tracked but do not block a credential-gated release.

**Recommendation:** The candidate is safe for `PARITY_READY_AWAITING_CREDENTIALS` state. The MEDIUM findings should be addressed before enabling org-admin enrichment or before claiming live Marketplace readiness. SEC-R2 (scan lease) requires live Forge KVS observation to close.

**No product code was modified during this audit.**
