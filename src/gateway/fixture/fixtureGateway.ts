/**
 * FixtureAtlassianGateway — the ONLY alternative transport.
 *
 * Implements the identical Atlas gateway interface as the production Forge
 * gateway. Synthetic raw responses are routed through the SAME adapters, so
 * downstream normalization/evidence/risk/finance/recommendation code cannot
 * tell them apart (parity equivalence by construction).
 *
 * This module is imported exclusively by tests and the development harness —
 * never by production entrypoints (ADV-3, enforced statically).
 */

import type {
  AtlassianGateway,
  GatewayOutcome,
  GatewayPage,
  PageCursor,
  PageMeta,
  RawTransportResponseLike,
  TelemetrySink,
  WireAppLicense,
  WireApplicationRole,
  WireContributionHit,
  WireGroup,
  WireIssueActivityHit,
  WireOrgUser,
  WirePlanInfo,
  WireSeatCount,
  WireUser,
} from '../types';
import {
  adaptOutcome,
  attributedContribution,
  parseWireAppLicense,
  parseWireApplicationRoles,
  parseWireConfluenceMemberItem,
  parseWireContributionItem,
  parseWireIssueActivityItem,
  parseWireOrgUsers,
  parseWirePlans,
  parseWireSeatCount,
  parseWireGroupItem,
  parseWireUserItem,
} from '../adapters';
import { DEFAULT_PACING, nextRetryDelay, seededRng } from '../pacing';
import {
  APPLICATION_ROLES,
  APPROXIMATE_COUNTS,
  DUPLICATE_ACCOUNT_IDS,
  FIXTURE_SCAN_NOW,
  FIXTURE_TENANT_NAME,
  GROUPS,
  INSTANCE_LICENSE,
  contributionsFor,
  issueHitsFor,
  orgUsersFor,
  usersFor,
  type FixtureVariant,
} from './dataset';

export interface FixtureOptions {
  variant: FixtureVariant;
  seed?: number;
  telemetry?: TelemetrySink;
}

/** Typed injected fault carrying HTTP semantics for the pacing policy. */
export class FixtureFault extends Error {
  constructor(
    public readonly status: number,
    public readonly headers: Record<string, string> = {},
  ) {
    super(`fixture fault ${status}`);
  }
}

function metaFor(slice: unknown[], startAt: number, returnedLimit: number, total: number | null): PageMeta {
  const effectiveTotal = total ?? Number.MAX_SAFE_INTEGER;
  return {
    startAt,
    total,
    pageSize: slice.length > 0 ? returnedLimit : Math.max(returnedLimit, 0),
    isLast: startAt + slice.length >= effectiveTotal,
    nextCursor: null,
    nextHref: null,
  };
}

/** Jira-style offset pagination honoring a deterministic mid-loop size change. */
function paginateOffsets<T>(all: T[], cursor: PageCursor, sizesPerPage: number[]): { slice: T[]; meta: PageMeta } {
  const startAt = cursor.startAt ?? 0;
  const requested = cursor.pageLimit ?? sizesPerPage[0];
  const pageIndex = sizesPerPage[0] > 0 ? Math.floor(startAt / sizesPerPage[0]) : 0;
  // Mid-loop page-size change: later pages respond with the second size.
  const effective = pageIndex > 0 && sizesPerPage.length > 1 ? sizesPerPage[1] : sizesPerPage[0];
  const slice = all.slice(startAt, startAt + effective);
  return { slice, meta: metaFor(slice, startAt, requested === effective ? effective : effective, all.length) };
}

function wireDate(daysAgo: number | null): string | null {
  if (daysAgo === null) return null;
  return new Date(Date.parse(FIXTURE_SCAN_NOW) - daysAgo * 86_400_000).toISOString();
}

export class FixtureAtlassianGateway implements AtlassianGateway {
  readonly tenantName = FIXTURE_TENANT_NAME;
  readonly dataModeConst = 'FIXTURE' as const;
  private callIndex = new Map<string, number>();
  private rng: () => number;

  constructor(private options: FixtureOptions) {
    this.rng = seededRng(options.seed ?? 20260826);
  }

  dataMode(): 'FIXTURE' {
    return 'FIXTURE';
  }

  private nextCallIndex(callName: string): number {
    const n = this.callIndex.get(callName) ?? 0;
    this.callIndex.set(callName, n + 1);
    return n;
  }

  /**
   * Central pacing loop mirroring production policy: Retry-After honored as a
   * floor, exponential backoff with seeded jitter, ceiling at maxAttempts.
   */
  private async paced<T>(
    callName: string,
    endpoint: string,
    produce: (attempt: number) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DEFAULT_PACING.maxAttempts; attempt += 1) {
      try {
        const value = await produce(attempt);
        this.options.telemetry?.record({
          callName,
          endpoint,
          status: 200,
          attempts: attempt,
          degradedFields: [],
          outcome: 'OK',
        });
        return value;
      } catch (err) {
        lastError = err;
        if (!(err instanceof FixtureFault)) break;
        const response: RawTransportResponseLike = { status: err.status, headers: err.headers, json: null, attempts: attempt };
        this.options.telemetry?.record({
          callName,
          endpoint,
          status: err.status,
          attempts: attempt,
          degradedFields: [],
          outcome:
            err.status === 401 || err.status === 403
              ? 'PERMISSION_DEGRADED'
              : err.status === 429
                ? 'RATE_LIMITED_EXHAUSTED'
                : 'SERVER_ERROR',
        });
        const decision = nextRetryDelay(attempt, response, DEFAULT_PACING, this.rng);
        if (!decision.retry) break;
      }
    }
    throw lastError;
  }

  private async paged<T>(
    callName: string,
    endpoint: string,
    produce: (attempt: number) => Promise<GatewayPage<T>>,
  ): Promise<GatewayPage<T>> {
    return this.paced(callName, endpoint, produce);
  }

  // ------------------------------------------------------------------ roles/plans

  async listJiraApplicationRoles(): Promise<GatewayOutcome<WireApplicationRole[]>> {
    return this.requestOutcome('listJiraApplicationRoles', '/rest/api/3/applicationrole', () => ({
      status: 200,
      headers: {},
      json: APPLICATION_ROLES.map((r) => ({
        key: r.key,
        name: r.name,
        groups: r.groups.map((g) => GROUPS.find((x) => x.id === g)?.name ?? g),
        groupDetails: r.groups.map((g) => ({ id: g, name: GROUPS.find((x) => x.id === g)?.name ?? g })),
        userCount: r.userCount,
        numberOfSeats: r.numberOfSeats,
        remainingSeats: r.remainingSeats,
        hasUnlimitedSeats: r.hasUnlimitedSeats,
      })),
    }), parseWireApplicationRoles);
  }

  async getInstanceLicensePlans(): Promise<GatewayOutcome<WirePlanInfo[]>> {
    return this.requestOutcome(
      'getInstanceLicensePlans',
      '/rest/api/3/instance/license',
      () => ({ status: 200, headers: {}, json: INSTANCE_LICENSE }),
      parseWirePlans,
    );
  }

  /** Experimental license metrics: tolerated absent (empty tenant returns 404). */
  async getApproximateLicenseCount(productKey?: string): Promise<GatewayOutcome<WireSeatCount>> {
    if (this.options.variant === 'empty_tenant') {
      return this.requestOutcome(
        'getApproximateLicenseCount',
        '/rest/api/3/license/approximateLicenseCount',
        () => ({ status: 404, headers: {}, json: null }),
        parseWireSeatCount,
      );
    }
    const key = productKey ?? 'total';
    const total = Object.prototype.hasOwnProperty.call(APPROXIMATE_COUNTS, key) ? APPROXIMATE_COUNTS[key] : null;
    return this.requestOutcome(
      'getApproximateLicenseCount',
      '/rest/api/3/license/approximateLicenseCount',
      () => ({ status: 200, headers: {}, json: { approximateLicenseCount: total, lastUpdated: FIXTURE_SCAN_NOW } }),
      parseWireSeatCount,
    );
  }

  /** Shared outcome path for non-paged calls (identical adapter route as production). */
  private async requestOutcome<T>(
    callName: string,
    endpoint: string,
    build: () => { status: number; headers: Record<string, string>; json: unknown | null },
    parseBody: (json: unknown) => T | null,
  ): Promise<GatewayOutcome<T>> {
    const idx = this.nextCallIndex(callName);
    const raw = build();
    const response: RawTransportResponseLike = { status: raw.status, headers: raw.headers, json: raw.json, attempts: 1 };
    const outcome = adaptOutcome<T>(response, parseBody);
    this.options.telemetry?.record({
      callName,
      endpoint,
      status: outcome.status,
      attempts: 1,
      degradedFields: outcome.degradedFields,
      outcome: outcome.ok
        ? 'OK'
        : outcome.status === 401 || outcome.status === 403
          ? 'PERMISSION_DEGRADED'
          : outcome.status === 404
            ? 'NOT_FOUND'
            : outcome.malformed
              ? 'MALFORMED'
              : 'ERROR',
    });
    void idx;
    return outcome;
  }

  // ------------------------------------------------------------------ jira inventory

  /**
   * RAW HTTP-shaped user payloads (SEC-M3): the fixture synthesizes the same
   * JSON shape production receives, then BOTH transports parse through
   * adapters.parseWireUserItem. The fixture never builds Wire DTOs inline.
   */
  private rawJiraUsers(): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    for (const u of usersFor(this.options.variant)) {
      const rec: Record<string, unknown> = {
        accountId: u.accountId,
        displayName: u.displayName,
        active: u.active,
        emailAddress: u.emailHint,
        accountType: u.accountType,
        createdDate: wireDate(u.createdDaysAgo),
      };
      rows.push(rec);
      if (DUPLICATE_ACCOUNT_IDS.has(u.accountId)) {
        rows.push({ ...rec, displayName: `${u.displayName} (dup)` });
      }
    }
    return rows.sort((a, b) => String(a.accountId).localeCompare(String(b.accountId)));
  }

  async listJiraUsers(cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.paged('listJiraUsers', '/rest/api/3/users', async (attempt) => {
      if (this.options.variant === 'rate_limit_recovery' && attempt === 1) {
        // Deterministic burst-limit breach with a 1s Retry-After floor (FP-21).
        throw new FixtureFault(429, { 'retry-after': '1', 'ratelimit-reason': 'jira-burst-based' });
      }
      const { slice, meta } = paginateOffsets(this.rawJiraUsers(), cursor, [2, 3]);
      return { values: slice.map(parseWireUserItem), meta, degradedFields: [] };
    });
  }

  async listGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>> {
    return this.paged('listGroups', '/rest/api/3/group/bulk', async () => {
      const raw = GROUPS.map((g) => ({ id: g.id, name: g.name }));
      const { slice, meta } = paginateOffsets(raw, cursor, [1, 2]);
      return { values: slice.map(parseWireGroupItem), meta, degradedFields: [] };
    });
  }

  async listGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.paged('listGroupMembers', `/rest/api/3/group/member?groupId=${groupId}`, async () => {
      if (this.options.variant === 'partial_failure' && groupId === 'fixture-group-jira-users') {
        // Repeated 5xx: exhausts retries -> stream FAILED -> PARTIAL scan (FP-22).
        throw new FixtureFault(500, {});
      }
      const members = usersFor(this.options.variant)
        .filter((u) => u.jiraGroups.includes(groupId))
        .map((u) => ({
          accountId: u.accountId,
          displayName: u.displayName,
          active: u.active,
          emailAddress: u.emailHint,
          accountType: u.accountType,
          createdDate: wireDate(u.createdDaysAgo),
        }))
        .sort((a, b) => a.accountId.localeCompare(b.accountId));
      const { slice, meta } = paginateOffsets(members, cursor, [2]);
      return { values: slice.map(parseWireUserItem), meta, degradedFields: [] };
    });
  }

  // ------------------------------------------------------------------ confluence

  async listConfluenceGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>> {
    return this.paged('listConfluenceGroups', '/wiki/rest/api/group', async () => {
      if (this.options.variant === 'insufficient_permissions') {
        throw new FixtureFault(403, {});
      }
      const confGroups = GROUPS.filter((g) => g.name.toLowerCase().includes('confluence'));
      const raw = confGroups.map((g) => ({ id: g.id, name: g.name }));
      const { slice, meta } = paginateOffsets(raw, cursor, [2]);
      // Confluence group listing has no reliable totalSize: surfaced as degraded field.
      return { values: slice.map(parseWireGroupItem), meta: { ...meta, total: null }, degradedFields: ['meta.total'] };
    });
  }

  async listConfluenceGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.paged('listConfluenceGroupMembers', `/wiki/rest/api/group/${groupId}/member`, async () => {
      if (this.options.variant === 'insufficient_permissions') {
        throw new FixtureFault(403, {});
      }
      // Wiki REST wraps the user under `account` and exposes `email` —
      // exercised through the SAME adapter as production (SEC-M3).
      const members = usersFor(this.options.variant)
        .filter((u) => u.confluenceGroups.includes(groupId))
        .map((u) => ({
          account: {
            accountId: u.accountId,
            displayName: u.displayName,
            active: u.active,
            email: u.emailHint,
            type: u.accountType,
          },
        }))
        .sort((a, b) => String(a.account.accountId).localeCompare(String(b.account.accountId)));
      const { slice, meta } = paginateOffsets(members, cursor, [2]);
      return { values: slice.map(parseWireConfluenceMemberItem), meta, degradedFields: [] };
    });
  }

  async searchConfluenceContributions(
    cqlAccountId: string,
    windowStartIso: string,
    _cursor: PageCursor,
  ): Promise<GatewayPage<WireContributionHit>> {
    return this.paged('searchConfluenceContributions', '/wiki/rest/api/search', async () => {
      if (this.options.variant === 'insufficient_permissions') {
        throw new FixtureFault(403, {});
      }
      // Window honored symmetrically with the live CQL filter (SEC-M3): a
      // contribution older than the window is NOT returned, exactly as
      // `lastmodified >= windowStart` behaves in production.
      const windowStartMs = Date.parse(windowStartIso);
      const days = contributionsFor(this.options.variant).get(cqlAccountId);
      const withinWindow =
        days !== undefined && Date.parse(FIXTURE_SCAN_NOW) - days * 86_400_000 >= windowStartMs;
      const rawResults = withinWindow
        ? [{ content: { id: `fixture-content-${cqlAccountId}` }, version: { when: wireDate(days ?? null) } }]
        : [];
      return {
        values: rawResults.map((r) => attributedContribution(parseWireContributionItem(r), cqlAccountId)),
        meta: metaFor(rawResults, 0, Math.max(rawResults.length, 1), rawResults.length),
        degradedFields: [],
      };
    });
  }

  // ------------------------------------------------------------------ jira activity

  async searchIssueActivity(windowStartIso: string, cursor: PageCursor): Promise<GatewayPage<WireIssueActivityHit>> {
    return this.paged('searchIssueActivity', '/rest/api/3/search/jql', async () => {
      const windowStartMs = Date.parse(windowStartIso);
      if (this.options.variant === 'truncated_pagination') {
        // Page 0 succeeds; every CONTINUATION fails hard: drain must abort and
        // mark coverage partial (ERR-7 / FP-19). Continuation is detected by
        // the presence of a cursor token, not by startAt.
        const isContinuation = typeof cursor.cursor === 'string' && cursor.cursor.length > 0;
        if (!isContinuation) {
          const all = this.rawIssueHitsWithin(windowStartMs);
          const firstTwo = all.slice(0, 2);
          return {
            values: firstTwo.map(parseWireIssueActivityItem),
            meta: {
              startAt: 0,
              total: all.length + 50,
              pageSize: 2,
              isLast: false,
              nextCursor: 'broken-cursor',
              nextHref: null,
            },
            degradedFields: [],
          };
        }
        throw new FixtureFault(500, {});
      }
      const { slice, meta } = paginateOffsets(this.rawIssueHitsWithin(windowStartMs), cursor, [3, 5]);
      return { values: slice.map(parseWireIssueActivityItem), meta, degradedFields: [] };
    });
  }

  /** RAW issue-search payload rows; parsed only via parseWireIssueActivityItem. */
  private rawIssueHitsWithin(windowStartMs: number): Array<Record<string, unknown>> {
    return issueHitsFor(this.options.variant)
      .filter((h) => {
        if (h.malformedTimestamps) return true; // preserved on purpose (ERR-6)
        const refDays = h.updatedDaysAgo ?? h.createdDaysAgo;
        if (!Number.isFinite(refDays)) return true;
        return Date.parse(FIXTURE_SCAN_NOW) - refDays * 86_400_000 >= windowStartMs;
      })
      .map((h) => ({
        key: h.key,
        fields: {
          creator: h.creator,
          assignee: h.assignee,
          reporter: h.reporter,
          created:
            h.malformedTimestamps
              ? 'also-not-a-timestamp'
              : wireDate(Number.isFinite(h.createdDaysAgo) ? h.createdDaysAgo : null),
          updated:
            h.malformedTimestamps || h.updatedDaysAgo === null
              ? 'not-a-timestamp'
              : wireDate(h.updatedDaysAgo),
        },
      }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }

  // ------------------------------------------------------------------ org enrichment

  orgConfigured(): boolean {
    return this.options.variant === 'org_enriched';
  }

  async listOrgUsers(cursor: PageCursor): Promise<GatewayPage<WireOrgUser>> {
    return this.paged('listOrgUsers', '/admin/v1/orgs/demo/users', async () => {
      const rows = orgUsersFor(this.options.variant).map<WireOrgUser>((o) => ({
        accountId: o.accountId,
        accessBillable: o.accessBillable,
        lastActive: wireDate(o.lastActiveDaysAgo),
        addedToOrg: wireDate(o.addedToOrgDaysAgo),
        productAccess: o.productAccess.map((p) => ({
          productId: p.productId,
          lastActive: wireDate(p.lastActiveDaysAgo),
          accessBillable: p.accessBillable,
        })),
      }));
      const start = cursor.cursor ? Number(cursor.cursor) : 0;
      const size = cursor.pageLimit ?? 100;
      const slice = rows.slice(start, start + size);
      return {
        values: slice,
        meta: {
          startAt: start,
          total: rows.length,
          pageSize: slice.length,
          isLast: start + slice.length >= rows.length,
          nextCursor: start + slice.length < rows.length ? String(start + slice.length) : null,
          nextHref: null,
        },
        degradedFields: [],
      };
    });
  }

  // ------------------------------------------------------------------ self license

  async getAppLicense(): Promise<GatewayOutcome<WireAppLicense>> {
    return this.requestOutcome(
      'getAppLicense',
      '/forge/app/v1/license',
      () => ({
        status: 200,
        headers: {},
        json: { active: true, type: null, isEvaluation: true, subscriptionEndDate: null, capabilitySet: null },
      }),
      parseWireAppLicense,
    );
  }
}

// Re-exported for contract tests asserting shape equivalence.
export {
  parseWireUserItem,
  parseWireContributionItem,
  parseWireUsers,
  parseWireContributions,
  parseWireGroupMembers,
  parseWireIssueActivity,
} from '../adapters';
