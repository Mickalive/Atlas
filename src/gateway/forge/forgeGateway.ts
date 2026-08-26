/**
 * ForgeAtlassianGateway — PRODUCTION transport.
 *
 * The only module that touches @forge/api for product acquisition. All
 * responses are parsed through the SAME shared adapters as the fixture
 * transport, and pacing/retry policy is identical (centralized in pacing.ts).
 *
 * Binding constraints implemented here:
 *  - Jira REST v3 paths only (forge-lint restriction); Confluence v1 wiki paths.
 *  - Seat groups resolved from applicationrole; no hard-coded group names.
 *  - Experimental endpoints tolerated absent (instance/license, metrics).
 *  - Identity mode explicit per call (default asApp; optional asUser fallback
 *    during interactive admin sessions — live verification settles L1).
 *  - Org-admin enrichment compiles but stays inert unless explicitly enabled
 *    by configuration (SEC-2c); never in the default request path.
 */

import type {
  AtlassianGateway,
  GatewayOutcome,
  GatewayPage,
  GatewayRequest,
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
import { ENDPOINTS } from '../types';
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

export type ForgeTransportRequest = GatewayRequest;

/** Injectable transport boundary over @forge/api (keeps unit tests offline). */
export interface ForgeTransport {
  request(req: ForgeTransportRequest): Promise<RawTransportResponseLike>;
}

interface ForgeApiModule {
  asApp(): {
    requestJira(path: string, opts?: unknown): Promise<ForgeResponseLike>;
    requestConfluence(path: string, opts?: unknown): Promise<ForgeResponseLike>;
  };
  asUser(): {
    requestJira(path: string, opts?: unknown): Promise<ForgeResponseLike>;
    requestConfluence(path: string, opts?: unknown): Promise<ForgeResponseLike>;
  };
}

interface ForgeResponseLike {
  status: number;
  headers?: Record<string, unknown> | { get(name: string): string | null };
  text(): Promise<string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headersToRecord(h: ForgeResponseLike['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (typeof (h as { get?: unknown }).get === 'function') {
    const getter = h as { get(name: string): string | null };
    for (const name of ['retry-after', 'x-ratelimit-remaining', 'ratelimit-reason', 'beta-retry-after']) {
      const v = getter.get(name);
      if (v !== null && v !== undefined) out[name] = String(v);
    }
    return out;
  }
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) out[k] = String(v);
  return out;
}

/**
 * Default production transport. @forge/api is imported lazily so this module
 * can be type-checked and unit-tested without a live Forge runtime.
 */
export async function defaultForgeTransport(): Promise<ForgeTransport> {
  const mod = (await import('@forge/api')) as unknown as ForgeApiModule;
  return {
    async request(req) {
      const api = req.identity.mode === 'asUser' ? mod.asUser() : mod.asApp();
      const postOpts =
        req.method === 'POST'
          ? { method: 'POST', body: JSON.stringify(req.body ?? {}), headers: { 'content-type': 'application/json' } }
          : {};
      let response: ForgeResponseLike;
      if (req.absoluteUrl) {
        // Org-admin enrichment only (feature-flagged OFF by default).
        response = await fetch(req.absoluteUrl, {
          method: req.method,
          headers: req.headers ?? {},
          body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
        });
      } else if (req.path.startsWith('/wiki/')) {
        response = await api.requestConfluence(req.path, postOpts);
      } else {
        response = await api.requestJira(req.path, postOpts);
      }
      const headers = headersToRecord(response.headers);
      let json: unknown = null;
      try {
        const text = await response.text();
        if (text) json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: response.status, headers, json };
    },
  };
}

export class GatewayPageError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly callName: string,
    public readonly retryAfterSec: number | null,
  ) {
    super(`gateway page error ${statusCode} on ${callName}`);
  }
}

export interface ForgeGatewayOptions {
  telemetry?: TelemetrySink;
  /** One-shot asUser retry after 401 on asApp (interactive sessions only). */
  userFallback?: boolean;
  /** Org-admin enrichment flags (OFF by default; SEC-2c). */
  orgEnrichment?: {
    enabled: boolean;
    orgId: string | null;
    /** Async resolver so the secret never sits in memory longer than needed. */
    getApiKey: () => Promise<string | null>;
  };
  transport?: ForgeTransport;
  sleepFn?: (ms: number) => Promise<void>;
  seed?: number;
}

export class ForgeAtlassianGateway implements AtlassianGateway {
  private rng: () => number;
  private transportPromise: Promise<ForgeTransport>;

  constructor(private options: ForgeGatewayOptions = {}) {
    this.rng = seededRng(options.seed ?? 42);
    this.transportPromise =
      options.transport !== undefined ? Promise.resolve(options.transport) : defaultForgeTransport();
  }

  dataMode(): 'LIVE' {
    return 'LIVE';
  }

  private recordTelemetry(callName: string, endpoint: string, status: number, attempts: number): void {
    this.options.telemetry?.record({
      callName,
      endpoint,
      status,
      attempts,
      degradedFields: [],
      outcome:
        status < 300 ? 'OK'
        : status === 401 || status === 403 ? 'PERMISSION_DEGRADED'
        : status === 404 ? 'NOT_FOUND'
        : status === 429 ? 'RATE_LIMITED_EXHAUSTED'
        : status >= 500 ? 'SERVER_ERROR'
        : 'ERROR',
    });
  }

  /**
   * Central paced request honoring Retry-After/backoff/jitter ceilings.
   * A single asUser hop after a 401 is permitted ONLY when interactive
   * fallback is explicitly enabled (feasibility 2.5 identity verification).
   */
  private async pacedRequest(baseReq: ForgeTransportRequest): Promise<RawTransportResponseLike> {
    const transport = await this.transportPromise;
    const sleepFn = this.options.sleepFn ?? sleep;
    let last: RawTransportResponseLike = { status: 0, headers: {}, json: null };
    let pendingFallback = false;
    let sentFallback = false;
    const ceiling = DEFAULT_PACING.maxAttempts + 1; // +1 headroom for the one-shot fallback

    for (let attempt = 1; attempt <= ceiling; attempt += 1) {
      const thisIsFallback = pendingFallback;
      pendingFallback = false;
      const req: ForgeTransportRequest = {
        ...baseReq,
        identity: thisIsFallback ? ({ mode: 'asUser' } as const) : baseReq.identity,
      };
      last = await transport.request(req);
      this.recordTelemetry(baseReq.callName, baseReq.path, last.status, attempt);

      if (last.status >= 200 && last.status < 300) return last;

      // One-shot interactive fallback bypasses pacing's no-retry-on-401 rule.
      if (
        !thisIsFallback &&
        !sentFallback &&
        this.options.userFallback === true &&
        baseReq.identity.mode !== 'asUser' &&
        last.status === 401
      ) {
        pendingFallback = true;
        sentFallback = true;
        continue;
      }

      const decision = nextRetryDelay(attempt, last, DEFAULT_PACING, this.rng);
      if (!decision.retry) break;
      await sleepFn(decision.delayMs);
    }
    return last;
  }

  private async outcome<T>(
    callName: string,
    path: string,
    parseBody: (json: unknown) => T | null,
    init?: { method?: 'GET' | 'POST'; body?: unknown; absoluteUrl?: string; headers?: Record<string, string> },
  ): Promise<GatewayOutcome<T>> {
    const raw = await this.pacedRequest({
      callName,
      method: init?.method ?? 'GET',
      path,
      body: init?.body,
      identity: { mode: 'asApp' },
      absoluteUrl: init?.absoluteUrl,
      headers: init?.headers,
    });
    return adaptOutcome<T>({ status: raw.status, headers: raw.headers, json: raw.json }, parseBody);
  }

  private metaFrom(json: Record<string, unknown>, values: unknown[], requestedLimit: number): PageMeta {
    const startAt = typeof json.startAt === 'number' ? json.startAt : typeof json.start === 'number' ? json.start : null;
    const totalRaw = json.total ?? json.size ?? json.totalSize ?? null;
    const total = typeof totalRaw === 'number' ? totalRaw : null;
    const isLastRaw = json.isLast ?? json.last ?? null;
    const nextPageToken = typeof json.nextPageToken === 'string' ? json.nextPageToken : null;
    const links = json._links as Record<string, unknown> | undefined;
    const nextHref = links && typeof links.next === 'string' ? links.next : null;
    const maxResults = typeof json.maxResults === 'number' ? json.maxResults : typeof json.limit === 'number' ? json.limit : requestedLimit;
    const meta: PageMeta = {
      startAt,
      total,
      pageSize: values.length > 0 ? Math.max(values.length, 0) || maxResults : 0,
      isLast: typeof isLastRaw === 'boolean' ? isLastRaw : nextHref === null && nextPageToken === null,
      nextCursor: nextPageToken,
      nextHref,
    };
    return meta;
  }

  private async page<T>(
    callName: string,
    endpoint: string,
    path: string,
    extractValues: (json: Record<string, unknown>) => unknown[] | null,
    parseItem: (raw: unknown) => T | null,
    cursor: PageCursor,
    buildPath: (p: string, c: PageCursor) => string = (p) => p,
  ): Promise<GatewayPage<T>> {
    const raw = await this.pacedRequest({
      callName,
      method: 'GET',
      path: buildPath(path, cursor),
      identity: { mode: 'asApp' },
    });
    const rec = raw.json !== null && typeof raw.json === 'object' ? (raw.json as Record<string, unknown>) : null;
    const arr = rec ? extractValues(rec) : null;
    if (!rec || !arr) {
      throw new GatewayPageError(raw.status, callName, null);
    }
    const parsed = arr.map(parseItem).filter((x): x is T => x !== null);
    void endpoint;
    return { values: parsed, meta: this.metaFrom(rec, parsed, cursor.pageLimit ?? 50), degradedFields: [] };
  }

  // ------------------------------------------------------------------ roles/plans

  async listJiraApplicationRoles(): Promise<GatewayOutcome<WireApplicationRole[]>> {
    return this.outcome('listJiraApplicationRoles', ENDPOINTS.jiraApplicationRoles, parseWireApplicationRoles);
  }

  /** Experimental; absence (404/malformed) tolerated and surfaced as null. */
  async getInstanceLicensePlans(): Promise<GatewayOutcome<WirePlanInfo[]>> {
    return this.outcome('getInstanceLicensePlans', ENDPOINTS.jiraInstanceLicense, parseWirePlans);
  }

  async getApproximateLicenseCount(productKey?: string): Promise<GatewayOutcome<WireSeatCount>> {
    const path =
      productKey === undefined
        ? ENDPOINTS.jiraApproximateLicenseCount
        : `${ENDPOINTS.jiraApproximateLicenseCount}/product/${encodeURIComponent(productKey)}`;
    return this.outcome('getApproximateLicenseCount', path, parseWireSeatCount);
  }

  // ------------------------------------------------------------------ jira inventory

  async listJiraUsers(cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.page(
      'listJiraUsers',
      ENDPOINTS.jiraUsers,
      ENDPOINTS.jiraUsers,
      (json) => (Array.isArray(json.values) ? json.values : Array.isArray(json) ? json : null),
      (raw) => {
        const r = raw as Record<string, unknown>;
        return {
          accountId: typeof r.accountId === 'string' ? r.accountId : null,
          displayName: typeof r.displayName === 'string' ? r.displayName : null,
          active: typeof r.active === 'boolean' ? r.active : null,
          emailHint: typeof r.emailAddress === 'string' ? r.emailAddress.toLowerCase() : null,
          accountType: typeof r.accountType === 'string' ? r.accountType : null,
          createdDate: typeof r.createdDate === 'string' ? r.createdDate : null,
        } satisfies WireUser;
      },
      cursor,
      (p, c) => `${p}?startAt=${c.startAt ?? 0}&maxResults=${c.pageLimit ?? 50}`,
    );
  }

  async listGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>> {
    return this.page(
      'listGroups',
      ENDPOINTS.jiraGroupsBulk,
      ENDPOINTS.jiraGroupsBulk,
      (json) => (Array.isArray(json.values) ? json.values : null),
      (raw) => {
        const r = raw as Record<string, unknown>;
        return { groupId: typeof r.groupId === 'string' ? r.groupId : typeof r.id === 'string' ? r.id : null, groupName: typeof r.name === 'string' ? r.name : null } satisfies WireGroup;
      },
      cursor,
      (p, c) => `${p}?startAt=${c.startAt ?? 0}&maxResults=${c.pageLimit ?? 50}`,
    );
  }

  async listGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.page(
      'listGroupMembers',
      ENDPOINTS.jiraGroupMember,
      ENDPOINTS.jiraGroupMember,
      (json) => (Array.isArray(json.values) ? json.values : null),
      (raw) => {
        const r = raw as Record<string, unknown>;
        return {
          accountId: typeof r.accountId === 'string' ? r.accountId : null,
          displayName: typeof r.displayName === 'string' ? r.displayName : null,
          active: typeof r.active === 'boolean' ? r.active : null,
          emailHint: typeof r.emailAddress === 'string' ? r.emailAddress.toLowerCase() : null,
          accountType: typeof r.accountType === 'string' ? r.accountType : null,
          createdDate: typeof r.createdDate === 'string' ? r.createdDate : null,
        } satisfies WireUser;
      },
      cursor,
      (p, c) => `${p}?groupId=${encodeURIComponent(groupId)}&includeInactiveUsers=true&startAt=${c.startAt ?? 0}&maxResults=${c.pageLimit ?? 50}`,
    );
  }

  async listUserGroups(accountId: string): Promise<GatewayOutcome<WireGroup[]>> {
    const out = await this.outcome(
      `listUserGroups(${accountId})`,
      `${ENDPOINTS.jiraUserGroups}?accountId=${encodeURIComponent(accountId)}`,
      parseWireGroups,
    );
    if (!out.ok || out.value === null) return { ...out, value: null };
    return { ...out, value: out.value.values };
  }

  // ------------------------------------------------------------------ confluence

  async listConfluenceGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>> {
    return this.page(
      'listConfluenceGroups',
      ENDPOINTS.confluenceGroups,
      ENDPOINTS.confluenceGroups,
      (json) => {
        if (Array.isArray(json.results)) return json.results;
        if (Array.isArray(json)) return json as unknown[];
        return null;
      },
      (raw) => {
        const r = raw as Record<string, unknown>;
        return { groupId: typeof r.id === 'string' ? r.id : null, groupName: typeof r.name === 'string' ? r.name : null } satisfies WireGroup;
      },
      cursor,
      (p, c) => `${p}?start=${c.startAt ?? 0}&limit=${c.pageLimit ?? 50}`,
    );
  }

  async listConfluenceGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.page(
      'listConfluenceGroupMembers',
      ENDPOINTS.confluenceGroupMembers.replace('{groupId}', encodeURIComponent(groupId)),
      ENDPOINTS.confluenceGroupMembers,
      (json) => (Array.isArray(json.results) ? json.results : null),
      (raw) => {
        const r = raw as Record<string, unknown>;
        const account = (r.account ?? r) as Record<string, unknown>;
        return {
          accountId: typeof account.accountId === 'string' ? account.accountId : null,
          displayName: typeof account.displayName === 'string' ? account.displayName : null,
          active: typeof account.active === 'boolean' ? account.active : null,
          emailHint: typeof account.email === 'string' ? account.email.toLowerCase() : null,
          accountType: typeof account.type === 'string' ? account.type : null,
          createdDate: null,
        } satisfies WireUser;
      },
      cursor,
      (p, c) => `${p}?start=${c.startAt ?? 0}&limit=${c.pageLimit ?? 50}`,
    );
  }

  async searchConfluenceContributions(
    cqlAccountId: string,
    windowStartIso: string,
    cursor: PageCursor,
  ): Promise<GatewayPage<WireContributionHit>> {
    const cql = `contributor="accountid:${cqlAccountId}" and lastmodified>="${windowStartIso.slice(0, 10)}" order by lastmodified desc`;
    const path = `${ENDPOINTS.confluenceSearch}?cql=${encodeURIComponent(cql)}&cursor=${cursor.cursor ?? ''}&limit=${cursor.pageLimit ?? 25}`;
    return this.page(
      'searchConfluenceContributions',
      ENDPOINTS.confluenceSearch,
      path,
      (json) => (Array.isArray(json.results) ? json.results : null),
      (raw) => {
        const r = raw as Record<string, unknown>;
        const content = (r.content ?? {}) as Record<string, unknown>;
        return {
          contentId: typeof content.id === 'string' ? content.id : null,
          lastModified: null, // identity comes from the per-account query itself
          contributorAccountId: cqlAccountId,
          creatorAccountId: cqlAccountId,
        } satisfies WireContributionHit;
      },
      cursor,
    );
  }

  // ------------------------------------------------------------------ jira activity

  /**
   * Site-wide contribution sweep via the enhanced JQL search API.
   * See docs/API_FEASIBILITY_ADDENDUM.md for the deviation record (VERIFY-LIVE).
   */
  async searchIssueActivity(windowStartIso: string, cursor: PageCursor): Promise<GatewayPage<WireIssueActivityHit>> {
    const body = {
      jql: `updated >= "${windowStartIso.slice(0, 10)}" ORDER BY updated DESC`,
      fields: ['creator', 'assignee', 'reporter', 'created', 'updated'],
      maxResults: cursor.pageLimit ?? 100,
      ...(cursor.cursor && !cursor.startAt ? { nextPageToken: cursor.cursor } : {}),
    };
    const raw = await this.pacedRequest({
      callName: 'searchIssueActivity',
      method: 'POST',
      path: ENDPOINTS.jiraSearchJql,
      body,
      identity: { mode: 'asApp' },
    });
    const rec = raw.json !== null && typeof raw.json === 'object' ? (raw.json as Record<string, unknown>) : null;
    const issues = rec && Array.isArray(rec.issues) ? rec.issues : null;
    if (!rec || !issues) throw new GatewayPageError(raw.status, 'searchIssueActivity', null);
    const values = issues.map((i): WireIssueActivityHit | null => {
      const ir = i as Record<string, unknown>;
      const fields = (ir.fields ?? {}) as Record<string, unknown>;
      const idOf = (v: unknown): string | null =>
        v === null || v === undefined
          ? null
          : typeof v === 'string'
            ? v
            : typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).accountId === 'string'
              ? ((v as Record<string, unknown>).accountId as string)
              : null;
      const iso = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
      return {
        issueKey: typeof ir.key === 'string' ? ir.key : typeof ir.id === 'string' ? ir.id : null,
        updated: iso(fields.updated),
        created: iso(fields.created),
        creatorAccountId: idOf(fields.creator),
        assigneeAccountId: idOf(fields.assignee),
        reporterAccountId: idOf(fields.reporter),
      };
    }).filter((x): x is WireIssueActivityHit => x !== null);

    return {
      values,
      meta: {
        startAt: null,
        total: typeof rec.total === 'number' ? rec.total : null,
        pageSize: values.length,
        isLast:
          typeof rec.nextPageToken === 'string' && rec.nextPageToken.length > 0
            ? false
            : true,
        nextCursor: typeof rec.nextPageToken === 'string' && rec.nextPageToken.length > 0 ? rec.nextPageToken : null,
        nextHref: null,
      },
      degradedFields: [],
    };
  }

  // ------------------------------------------------------------------ org enrichment

  orgConfigured(): boolean {
    const flags = this.options.orgEnrichment;
    return Boolean(flags?.enabled && flags.orgId);
  }

  async listOrgUsers(cursor: PageCursor): Promise<GatewayPage<WireOrgUser>> {
    if (!this.orgConfigured()) throw new GatewayPageError(412, 'listOrgUsers', null);
    const flags = this.options.orgEnrichment!;
    const apiKey = await flags.getApiKey();
    if (!apiKey) throw new GatewayPageError(412, 'listOrgUsers', null);
    const base = `https://api.atlassian.com/admin/v1/orgs/${encodeURIComponent(flags.orgId!)}/users`;
    const url = cursor.cursor ? `${base}?cursor=${encodeURIComponent(cursor.cursor)}&limit=${cursor.pageLimit ?? 100}` : `${base}?limit=${cursor.pageLimit ?? 100}`;
    const raw = await this.pacedRequest({
      callName: 'listOrgUsers',
      method: 'GET',
      path: '/admin/v1/orgs/{orgId}/users',
      identity: { mode: 'asApp' },
      absoluteUrl: url,
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });
    const outcome = adaptOutcome<{ values: WireOrgUser[] }>(
      { status: raw.status, headers: raw.headers, json: raw.json },
      parseWireOrgUsers,
    );
    if (!outcome.ok || !outcome.value) throw new GatewayPageError(outcome.status, 'listOrgUsers', outcome.rateLimit?.retryAfterSec ?? null);
    const rec = (raw.json ?? {}) as Record<string, unknown>;
    const links = (rec.links ?? {}) as Record<string, unknown>;
    return {
      values: outcome.value.values,
      meta: {
        startAt: null,
        total: null,
        pageSize: outcome.value.values.length,
        isLast: typeof links.next !== 'string',
        nextCursor: typeof links.next === 'string' ? links.next : null,
        nextHref: typeof links.next === 'string' ? links.next : null,
      },
      degradedFields: [],
    };
  }

  // ------------------------------------------------------------------ self license

  async getAppLicense(): Promise<GatewayOutcome<WireAppLicense>> {
    return this.outcome('getAppLicense', '/forge/app/v1/license', parseWireAppLicense);
  }
}
