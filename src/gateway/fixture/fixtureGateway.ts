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
  parseWireAppLicense,
  parseWireApplicationRoles,
  parseWireContributions,
  parseWireGroupMembers,
  parseWireGroups,
  parseWireIssueActivity,
  parseWireOrgUsers,
  parseWirePlans,
  parseWireSeatCount,
  parseWireUsers,
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

  private wireUsersAll(): WireUser[] {
    const wire: WireUser[] = [];
    for (const u of usersFor(this.options.variant)) {
      const rec: WireUser = {
        accountId: u.accountId,
        displayName: u.displayName,
        active: u.active,
        emailHint: u.emailHint,
        accountType: u.accountType,
        createdDate: wireDate(u.createdDaysAgo),
      };
      wire.push(rec);
      if (DUPLICATE_ACCOUNT_IDS.has(u.accountId)) {
        wire.push({ ...rec, displayName: `${u.displayName} (dup)` });
      }
    }
    return wire.sort((a, b) => (a.accountId ?? '').localeCompare(b.accountId ?? ''));
  }

  async listJiraUsers(cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.paged('listJiraUsers', '/rest/api/3/users', async (attempt) => {
      if (this.options.variant === 'rate_limit_recovery' && attempt === 1) {
        // Deterministic burst-limit breach with a 1s Retry-After floor (FP-21).
        throw new FixtureFault(429, { 'retry-after': '1', 'ratelimit-reason': 'jira-burst-based' });
      }
      const wire = this.wireUsersAll();
      const { slice, meta } = paginateOffsets(wire, cursor, [2, 3]);
      return { values: slice, meta, degradedFields: [] };
    });
  }

  async listGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>> {
    return this.paged('listGroups', '/rest/api/3/group/bulk', async () => {
      const wire: WireGroup[] = GROUPS.map((g) => ({ groupId: g.id, groupName: g.name }));
      const { slice, meta } = paginateOffsets(wire, cursor, [1, 2]);
      return { values: slice, meta, degradedFields: [] };
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
        .map<WireUser>((u) => ({
          accountId: u.accountId,
          displayName: u.displayName,
          active: u.active,
          emailHint: u.emailHint,
          accountType: u.accountType,
          createdDate: wireDate(u.createdDaysAgo),
        }))
        .sort((a, b) => (a.accountId ?? '').localeCompare(b.accountId ?? ''));
      const { slice, meta } = paginateOffsets(members, cursor, [2]);
      return { values: slice, meta, degradedFields: [] };
    });
  }

  async listUserGroups(accountId: string): Promise<GatewayOutcome<WireGroup[]>> {
    const spec = usersFor(this.options.variant).find((u) => u.accountId === accountId);
    const ids = spec ? [...spec.jiraGroups].sort() : [];
    const out = await this.requestOutcome(
      `listUserGroups(${accountId})`,
      '/rest/api/3/user/groups',
      () => ({
        status: 200,
        headers: {},
        json: { values: ids.map((id) => ({ groupId: id, name: GROUPS.find((g) => g.id === id)?.name ?? id })) },
      }),
      parseWireGroups,
    );
    if (!out.ok || out.value === null) {
      return { ...out, value: null };
    }
    return { ...out, value: out.value.values };
  }

  // ------------------------------------------------------------------ confluence

  async listConfluenceGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>> {
    return this.paged('listConfluenceGroups', '/wiki/rest/api/group', async () => {
      if (this.options.variant === 'insufficient_permissions') {
        throw new FixtureFault(403, {});
      }
      const confGroups = GROUPS.filter((g) => g.name.toLowerCase().includes('confluence'));
      const wire: WireGroup[] = confGroups.map((g) => ({ groupId: g.id, groupName: g.name }));
      const { slice, meta } = paginateOffsets(wire, cursor, [2]);
      // Confluence group listing has no reliable totalSize: surfaced as degraded field.
      return { values: slice, meta: { ...meta, total: null }, degradedFields: ['meta.total'] };
    });
  }

  async listConfluenceGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.paged('listConfluenceGroupMembers', `/wiki/rest/api/group/${groupId}/member`, async () => {
      if (this.options.variant === 'insufficient_permissions') {
        throw new FixtureFault(403, {});
      }
      const members = usersFor(this.options.variant)
        .filter((u) => u.confluenceGroups.includes(groupId))
        .map<WireUser>((u) => ({
          accountId: u.accountId,
          displayName: u.displayName,
          active: u.active,
          emailHint: u.emailHint,
          accountType: u.accountType,
          createdDate: null,
        }))
        .sort((a, b) => (a.accountId ?? '').localeCompare(b.accountId ?? ''));
      const { slice, meta } = paginateOffsets(members, cursor, [2]);
      return { values: slice, meta, degradedFields: [] };
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
      void windowStartIso;
      const days = contributionsFor(this.options.variant).get(cqlAccountId);
      const hits: WireContributionHit[] =
        days === undefined
          ? []
          : [
              {
                contentId: `fixture-content-${cqlAccountId}`,
                lastModified: wireDate(days),
                contributorAccountId: cqlAccountId,
                creatorAccountId: cqlAccountId,
              },
            ];
      return {
        values: hits,
        meta: metaFor(hits, 0, Math.max(hits.length, 1), hits.length),
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
          const all = this.issueHitsWithin(windowStartMs);
          const firstTwo = all.slice(0, 2);
          return {
            values: firstTwo,
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
      const hits = this.issueHitsWithin(windowStartMs);
      const { slice, meta } = paginateOffsets(hits, cursor, [3, 5]);
      return { values: slice, meta, degradedFields: [] };
    });
  }

  private issueHitsWithin(windowStartMs: number): WireIssueActivityHit[] {
    return issueHitsFor(this.options.variant)
      .filter((h) => {
        if (h.malformedTimestamps) return true; // preserved on purpose (ERR-6)
        const refDays = h.updatedDaysAgo ?? h.createdDaysAgo;
        if (!Number.isFinite(refDays)) return true;
        return Date.parse(FIXTURE_SCAN_NOW) - refDays * 86_400_000 >= windowStartMs;
      })
      .map<WireIssueActivityHit>((h) => ({
        issueKey: h.key,
        updated: h.malformedTimestamps || h.updatedDaysAgo === null ? 'not-a-timestamp' : wireDate(h.updatedDaysAgo),
        created: h.malformedTimestamps ? 'also-not-a-timestamp' : wireDate(Number.isFinite(h.createdDaysAgo) ? h.createdDaysAgo : null),
        creatorAccountId: h.creator,
        assigneeAccountId: h.assignee,
        reporterAccountId: h.reporter,
      }))
      .sort((a, b) => (a.issueKey ?? '').localeCompare(b.issueKey ?? ''));
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
export { parseWireUsers, parseWireContributions, parseWireGroupMembers, parseWireIssueActivity };
