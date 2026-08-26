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
  attributedContribution,
  parseWireAppLicense,
  parseWireApplicationRoles,
  parseWireConfluenceMemberItem,
  parseWireContributionItem,
  parseWireGroupItem,
  parseWireIssueActivityItem,
  parseWireOrgUsers,
  parseWirePlans,
  parseWireSeatCount,
  parseWireUserItem,
} from '../adapters';
import { DEFAULT_PACING, nextRetryDelay, seededRng } from '../pacing';

/**
 * Pagination termination flavors (functional HIGH 5):
 *  - 'offset' endpoints document isLast/total but live shapes are VERIFY-LIVE;
 *    when a response carries NEITHER an explicit terminal flag NOR a
 *    continuation pointer, isLast is surfaced as null (UNKNOWN). The scan
 *    service then probes forward and treats an unverifiable continuation as
 *    INCOMPLETE — never as complete.
 *  - 'token' endpoints define termination protocol-side (no next token /
 *    next link == end of result set, per docs/API_FEASIBILITY_ADDENDUM.md
 *    A1 and the org-API docs). Absence of the continuation pointer after a
 *    non-empty page IS the documented end signal.
 */
type TerminationFlavor = 'offset' | 'token';

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

  private metaFrom(
    json: Record<string, unknown>,
    values: unknown[],
    flavor: TerminationFlavor,
  ): PageMeta {
    const startAt = typeof json.startAt === 'number' ? json.startAt : typeof json.start === 'number' ? json.start : null;
    // `size` is the PAGE SIZE in wiki REST responses, not the collection
    // total — only unambiguous total fields are trusted here.
    const totalRaw = json.total ?? json.totalSize ?? null;
    const total = typeof totalRaw === 'number' ? totalRaw : null;
    const isLastRaw = json.isLast ?? json.last ?? null;
    const nextPageToken = typeof json.nextPageToken === 'string' && json.nextPageToken.length > 0 ? json.nextPageToken : null;
    const links = json._links as Record<string, unknown> | undefined;
    const nextHref = links && typeof links.next === 'string' ? links.next : null;
    let isLast: boolean | null;
    if (typeof isLastRaw === 'boolean') {
      isLast = isLastRaw;
    } else if (flavor === 'token') {
      isLast = nextPageToken !== null || nextHref !== null ? false : true;
    } else {
      // Unknown continuation state: surfaced as null so downstream treats the
      // stream as unverified instead of silently complete (functional HIGH 5).
      isLast = nextPageToken !== null || nextHref !== null ? false : null;
    }
    return {
      startAt,
      total,
      pageSize: Math.max(values.length, 0),
      isLast,
      nextCursor: nextPageToken,
      nextHref,
    };
  }

  private async page<T>(
    callName: string,
    endpoint: string,
    path: string,
    extractValues: (json: Record<string, unknown>) => unknown[] | null,
    parseItem: (raw: unknown) => T,
    cursor: PageCursor,
    flavor: TerminationFlavor,
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
    const parsed = arr.map(parseItem);
    void endpoint;
    return { values: parsed, meta: this.metaFrom(rec, parsed, flavor), degradedFields: [] };
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
      parseWireUserItem,
      cursor,
      'offset',
      (p, c) => `${p}?startAt=${c.startAt ?? 0}&maxResults=${c.pageLimit ?? 50}`,
    );
  }

  async listGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>> {
    return this.page(
      'listGroups',
      ENDPOINTS.jiraGroupsBulk,
      ENDPOINTS.jiraGroupsBulk,
      (json) => (Array.isArray(json.values) ? json.values : null),
      parseWireGroupItem,
      cursor,
      'offset',
      (p, c) => `${p}?startAt=${c.startAt ?? 0}&maxResults=${c.pageLimit ?? 50}`,
    );
  }

  async listGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.page(
      'listGroupMembers',
      ENDPOINTS.jiraGroupMember,
      ENDPOINTS.jiraGroupMember,
      (json) => (Array.isArray(json.values) ? json.values : null),
      parseWireUserItem,
      cursor,
      'offset',
      (p, c) => `${p}?groupId=${encodeURIComponent(groupId)}&includeInactiveUsers=true&startAt=${c.startAt ?? 0}&maxResults=${c.pageLimit ?? 50}`,
    );
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
      parseWireGroupItem,
      cursor,
      'offset',
      (p, c) => `${p}?start=${c.startAt ?? 0}&limit=${c.pageLimit ?? 50}`,
    );
  }

  async listConfluenceGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>> {
    return this.page(
      'listConfluenceGroupMembers',
      ENDPOINTS.confluenceGroupMembers,
      // The REQUEST path must carry the substituted id; the template stays
      // endpoint-only telemetry. (Pre-repair these two were swapped: live
      // calls would have requested the literal '{groupId}' path — a defect
      // only the raw-payload live-shape parity test can observe.)
      ENDPOINTS.confluenceGroupMembers.replace('{groupId}', encodeURIComponent(groupId)),
      (json) => (Array.isArray(json.results) ? json.results : null),
      parseWireConfluenceMemberItem,
      cursor,
      'offset',
      (p, c) => `${p}?start=${c.startAt ?? 0}&limit=${c.pageLimit ?? 50}`,
    );
  }

  /**
   * Per-account Confluence contribution sweep. The CQL is window-filtered by
   * construction (`lastmodified >= windowStart`), so ANY returned hit IS
   * within-window activity and its `version.when` timestamp is preserved
   * through the shared adapter. Building hits inline with a null timestamp —
   * the pre-repair defect — fabricated "measured absence" for active users
   * and is structurally impossible now: parsing happens ONLY in
   * adapters.parseWireContributionItem (functional BLOCKER 1).
   */
  async searchConfluenceContributions(
    cqlAccountId: string,
    windowStartIso: string,
    cursor: PageCursor,
  ): Promise<GatewayPage<WireContributionHit>> {
    const cql = `contributor="accountid:${cqlAccountId}" and lastmodified>="${windowStartIso.slice(0, 10)}" order by lastmodified desc`;
    const path = `${ENDPOINTS.confluenceSearch}?cql=${encodeURIComponent(cql)}&cursor=${cursor.cursor ?? ''}&limit=${cursor.pageLimit ?? 25}`;
    const pageOut = await this.page(
      'searchConfluenceContributions',
      ENDPOINTS.confluenceSearch,
      path,
      (json) => (Array.isArray(json.results) ? json.results : null),
      (raw) => attributedContribution(parseWireContributionItem(raw), cqlAccountId),
      cursor,
      'token',
    );
    void windowStartIso; // encoded into the CQL above (window-filtered query)
    return pageOut;
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
    const values = issues.map(parseWireIssueActivityItem);

    return {
      values,
      meta: this.metaFrom(rec, values, 'token'),
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
