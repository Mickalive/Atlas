/**
 * Atlas-owned Atlassian gateway boundary.
 *
 * BINDING RULES (docs/API_FEASIBILITY.md §8, docs/FORGE_PARITY_MODE.md):
 *  - Everything downstream imports ONLY this interface — never @forge/* .
 *  - Exactly two implementations: ForgeAtlassianGateway (production) and
 *    FixtureAtlassianGateway (deterministic development/test data).
 *  - Both implementations emit identical Wire* envelope semantics, produced
 *    through the shared adapters in ./adapters where responses are parsed.
 *  - Every call records telemetry so partial scans stay auditable.
 */

import type {
  ApplicationRole,
  ApproximateSeatCount,
  ProductPlanInfo,
} from '../core/types';

/** Explicit identity mode per call; live verification settles per-endpoint behavior. */
export type Identity = { mode: 'asApp' } | { mode: 'asUser'; accountId?: string };

export interface PageCursor {
  /** Jira-style offset pagination. */
  startAt?: number;
  /** Confluence/Org-style opaque cursor or href. */
  cursor?: string | null;
  /** Requested page size; responders may clamp — always honor returned sizes. */
  pageLimit?: number;
}

export interface PageMeta {
  startAt: number | null;
  /** Total when the API provides one reliably; null otherwise (Confluence groups). */
  total: number | null;
  /** The page size actually returned by the responder. */
  pageSize: number;
  isLast: boolean | null;
  nextCursor: string | null;
  nextHref: string | null;
}

export interface RateLimitMeta {
  retryAfterSec?: number;
  remaining?: number;
  reason?: string;
}

export interface GatewayPage<T> {
  values: T[];
  meta: PageMeta;
  rateLimit?: RateLimitMeta;
  /** Fields absent/unknown in this response (never coerced to zero/false). */
  degradedFields: string[];
}

// ---------------------------------------------------------------------------
// Wire DTOs — thin, tolerant mirrors of upstream payload shapes.
// Unknown/absent fields stay null; malformed values are preserved as null by
// the shared adapters (ERR-6), never defaulted to activity-absent.
// ---------------------------------------------------------------------------

export interface WireUser {
  accountId: string | null;
  displayName: string | null;
  /** Platform deactivated flag; null means not provided. */
  active: boolean | null;
  /** Lowercased LOCAL PART only, used exclusively by service-account heuristics; full addresses are never stored (SEC-3/SEC-L2). */
  emailHint: string | null;
  accountType: string | null;
  createdDate: string | null;
}

export interface WireGroup {
  groupId: string | null;
  groupName: string | null;
}

export interface WireGroupMembershipPage extends GatewayPage<WireUser> {}

export interface WireApplicationRole {
  roleKey: string | null;
  name: string | null;
  groupIds: string[];
  userCount: number | null;
  numberOfSeats: number | null;
  remainingSeats: number | null;
  hasUnlimitedSeats: boolean | null;
}

export interface WirePlanInfo {
  applicationId: string | null;
  planRaw: string | null;
}

export interface WireSeatCount {
  total: number | null;
  asOfHint: string | null;
}

export interface WireIssueActivityHit {
  issueKey: string | null;
  updated: string | null;
  created: string | null;
  creatorAccountId: string | null;
  assigneeAccountId: string | null;
  reporterAccountId: string | null;
}

export interface WireContributionHit {
  contentId: string | null;
  lastModified: string | null;
  contributorAccountId: string | null;
  creatorAccountId: string | null;
}

export interface WireOrgProductAccess {
  productId: string | null;
  lastActive: string | null;
  accessBillable: boolean | null;
}

export interface WireOrgUser {
  accountId: string | null;
  accessBillable: boolean | null;
  lastActive: string | null;
  productAccess: WireOrgProductAccess[];
  addedToOrg: string | null;
}

export interface WireAppLicense {
  active: boolean | null;
  type: string | null;
  isEvaluation: boolean | null;
  subscriptionEndDate: string | null;
  capabilitySet: string[] | null;
}

// ---------------------------------------------------------------------------
// Transport discipline
// ---------------------------------------------------------------------------

export interface GatewayRequest {
  /** Canonical call name for telemetry/pacing decisions. */
  callName: string;
  method: 'GET' | 'POST';
  /** Full path incl. query, e.g. /rest/api/3/users?startAt=0 . */
  path: string;
  body?: unknown;
  identity: Identity;
  /** Absolute URL required only for org-admin enrichment (feature-flagged OFF by default). */
  absoluteUrl?: string;
  headers?: Record<string, string>;
}

/**
 * A parsed transport outcome shared by both implementations.
 * status is the effective HTTP-style classification after policy application.
 */
export interface GatewayOutcome<T> {
  ok: boolean;
  status: number;
  value: T | null;
  rateLimit?: RateLimitMeta;
  /** Set when the responder returned a malformed/unparseable payload (ERR-6). */
  malformed: boolean;
  attempts: number;
  degradedFields: string[];
}

/**
 * Minimal HTTP-shaped response view shared by both gateways. Production
 * transport maps @forge/api responses onto this; fixtures synthesize it.
 */
export interface RawTransportResponseLike {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON when parseable; null when missing/unparseable. */
  json: unknown | null;
  attempts?: number;
}

export interface CallTelemetryRecord {
  callName: string;
  endpoint: string;
  status: number;
  attempts: number;
  degradedFields: string[];
  outcome: 'OK' | 'PERMISSION_DEGRADED' | 'NOT_FOUND' | 'RATE_LIMITED_EXHAUSTED' | 'SERVER_ERROR' | 'MALFORMED' | 'ERROR';
}

/** Telemetry sink passed to gateways; scan service persists it per stream. */
export interface TelemetrySink {
  record(entry: CallTelemetryRecord): void;
}

/**
 * THE Atlas gateway interface. Production and fixture implementations are the
 * only two conformers. Downstream code depends on nothing else for acquisition.
 */
export interface AtlassianGateway {
  // --- inventory ---
  listJiraApplicationRoles(): Promise<GatewayOutcome<WireApplicationRole[]>>;
  getInstanceLicensePlans(): Promise<GatewayOutcome<WirePlanInfo[]>>;
  getApproximateLicenseCount(productKey?: string): Promise<GatewayOutcome<WireSeatCount>>;
  listJiraUsers(cursor: PageCursor): Promise<GatewayPage<WireUser>>;
  listGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>>;
  listGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>>;

  // --- Confluence ---
  listConfluenceGroups(cursor: PageCursor): Promise<GatewayPage<WireGroup>>;
  listConfluenceGroupMembers(groupId: string, cursor: PageCursor): Promise<GatewayPage<WireUser>>;
  searchConfluenceContributions(
    cqlAccountId: string,
    windowStartIso: string,
    cursor: PageCursor,
  ): Promise<GatewayPage<WireContributionHit>>;

  // --- Jira activity evidence ---
  searchIssueActivity(windowStartIso: string, cursor: PageCursor): Promise<GatewayPage<WireIssueActivityHit>>;

  // --- optional org-admin enrichment (feature-flagged OFF in V1 default path) ---
  orgConfigured(): boolean;
  listOrgUsers(cursor: PageCursor): Promise<GatewayPage<WireOrgUser>>;

  // --- app self-license ---
  getAppLicense(): Promise<GatewayOutcome<WireAppLicense>>;
}

/** Endpoint identifiers used across gateways (single source of truth). */
export const ENDPOINTS = {
  jiraApplicationRoles: '/rest/api/3/applicationrole',
  jiraInstanceLicense: '/rest/api/3/instance/license',
  jiraApproximateLicenseCount: '/rest/api/3/license/approximateLicenseCount',
  jiraUsers: '/rest/api/3/users',
  jiraGroupsBulk: '/rest/api/3/group/bulk',
  jiraGroupMember: '/rest/api/3/group/member',
  jiraSearchJql: '/rest/api/3/search/jql',
  confluenceGroups: '/wiki/rest/api/group',
  confluenceGroupMembers: '/wiki/rest/api/group/{groupId}/member',
  confluenceSearch: '/wiki/rest/api/search',
  orgUsers: '/admin/v1/orgs/{orgId}/users',
} as const;

/**
 * Scope budget: every manifest scope must appear here AND be exercised by at
 * least one named gateway call THAT ACTUALLY EXISTS in a transport
 * implementation (GATE-2, hardened per SEC-H1: scripts/static-gates.mjs
 * extracts `calls` from this file and greps the gateway sources for real call
 * sites — a scope with no exercising call fails the gate; set equality alone
 * proves nothing).
 *
 * `justified` scopes have an endpoint-level basis recorded in
 * docs/API_FEASIBILITY_ADDENDUM.md even though no Atlas code consumes the
 * specific subfields (e.g. avatar): the endpoint is exercised and current
 * feasibility documentation lists the scope among its requirements.
 * VERIFY-LIVE: drop any justified-but-unconsumed scope if live evidence shows
 * the endpoint serves without it.
 */
export const SCOPE_BUDGET: Record<string, { calls: string[]; justified?: string }> = {
  'read:license:jira': { calls: ['getInstanceLicensePlans', 'getApproximateLicenseCount'] },
  'read:application-role:jira': { calls: ['listJiraApplicationRoles'] },
  'read:user:jira': { calls: ['listJiraUsers', 'listGroupMembers', 'searchIssueActivity'] },
  'read:group:jira': { calls: ['listGroups', 'listGroupMembers'] },
  'read:avatar:jira': {
    calls: ['listJiraUsers', 'listGroupMembers'],
    justified: 'feasibility endpoint table lists this scope for /rest/api/3/users and /rest/api/3/group/member; see addendum A7 (VERIFY-LIVE: drop if served without it)',
  },
  'read:jira-work': {
    calls: ['searchIssueActivity'],
    justified: 'recorded deviation A1 — exact accepted scope string VERIFY-LIVE',
  },
  'read:content-details:confluence': { calls: ['searchConfluenceContributions'] },
  'read:user:confluence': { calls: ['listConfluenceGroupMembers'] },
  'read:group:confluence': { calls: ['listConfluenceGroups', 'listConfluenceGroupMembers'] },
};;
