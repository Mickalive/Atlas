/**
 * Shared response adapters: raw HTTP-shaped responses -> Wire DTOs.
 *
 * BOTH gateway implementations route parsing through these functions, so a
 * fixture response and a live response with identical shapes produce
 * identical downstream data by construction (parity equivalence, AC10).
 *
 * Malformed/unknown fields are preserved as null (ERR-6) — never coerced into
 * activity-absence, never defaulted to zero/false where meaning would change.
 */

import type {
  GatewayOutcome,
  RawTransportResponseLike,
  WireAppLicense,
  WireApplicationRole,
  WireContributionHit,
  WireGroup,
  WireIssueActivityHit,
  WireOrgProductAccess,
  WireOrgUser,
  WirePlanInfo,
  WireSeatCount,
  WireUser,
} from './types';

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function isoOrNull(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function emailHint(v: unknown): string | null {
  const s = str(v);
  if (!s || !s.includes('@')) return null;
  // Keep only a sanitized hint; full addresses are not stored (SEC-3).
  const [local, domain] = s.split('@');
  return `${local.toLowerCase()}@${domain.toLowerCase()}`;
}

function accountIdOf(v: unknown): string | null {
  if (typeof v === 'string') return str(v);
  const rec = asRecord(v);
  if (rec) return str(rec.accountId);
  return null;
}

// ---------------------------------------------------------------------------
// Envelope-level outcome adapter
// ---------------------------------------------------------------------------

export function adaptOutcome<T>(
  response: RawTransportResponseLike,
  parseBody: (json: unknown) => T | null,
): GatewayOutcome<T> {
  if (response.status === 429) {
    return {
      ok: false,
      status: 429,
      value: null,
      malformed: false,
      attempts: response.attempts ?? 1,
      degradedFields: [],
      rateLimit: {
        retryAfterSec: numOrNull(headerOf(response, 'retry-after')) ?? undefined,
        remaining: numOrNull(headerOf(response, 'x-ratelimit-remaining')) ?? undefined,
        reason: str(headerOf(response, 'ratelimit-reason')) ?? undefined,
      },
    };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: response.status, value: null, malformed: false, attempts: response.attempts ?? 1, degradedFields: [] };
  }
  if (response.status === 404) {
    return { ok: false, status: 404, value: null, malformed: false, attempts: response.attempts ?? 1, degradedFields: [] };
  }
  if (response.status >= 500) {
    return { ok: false, status: response.status, value: null, malformed: false, attempts: response.attempts ?? 1, degradedFields: [] };
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, status: response.status, value: null, malformed: false, attempts: response.attempts ?? 1, degradedFields: [] };
  }
  // Some endpoints (e.g. /rest/api/3/applicationrole) return a bare JSON
  // array: shape validation belongs to the specific parser, not here.
  if (response.json === null) {
    return { ok: false, status: response.status, value: null, malformed: true, attempts: response.attempts ?? 1, degradedFields: [] };
  }
  const parsed = parseBody(response.json);
  if (parsed === null) {
    return { ok: false, status: response.status, value: null, malformed: true, attempts: response.attempts ?? 1, degradedFields: [] };
  }
  return { ok: true, status: response.status, value: parsed, malformed: false, attempts: response.attempts ?? 1, degradedFields: [] };
}

function headerOf(response: RawTransportResponseLike, nameLower: string): string | null {
  const headers = response.headers ?? {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === nameLower) return typeof v === 'string' ? v : String(v);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Body adapters
// ---------------------------------------------------------------------------

export function parseWireUsers(json: unknown): { values: WireUser[] } | null {
  const rec = asRecord(json);
  if (!rec) return null;
  const arr = Array.isArray(rec.values) ? rec.values : Array.isArray(json) ? json : null;
  if (!arr) return null;
  return {
    values: arr.map((u) => {
      const r = asRecord(u) ?? {};
      return {
        accountId: str(r.accountId),
        displayName: str(r.displayName),
        active: boolOrNull(r.active),
        emailHint: emailHint(r.emailAddress),
        accountType: str(r.accountType),
        createdDate: isoOrNull(r.createdDate),
      };
    }),
  };
}

export function parseWireGroups(json: unknown): { values: WireGroup[] } | null {
  const rec = asRecord(json);
  if (!rec) return null;
  const arr = Array.isArray(rec.values) ? rec.values : null;
  if (!arr) return null;
  return {
    values: arr.map((g) => {
      const r = asRecord(g) ?? {};
      return { groupId: str(r.groupId) ?? str(r.id), groupName: str(r.name) };
    }),
  };
}

export function parseWireGroupMembers(json: unknown): { values: WireUser[] } | null {
  const rec = asRecord(json);
  if (!rec) return null;
  const arr = Array.isArray(rec.values) ? rec.values : null;
  if (!arr) return null;
  return {
    values: arr.map((u) => {
      const r = asRecord(u) ?? {};
      return {
        accountId: str(r.accountId),
        displayName: str(r.displayName),
        active: boolOrNull(r.active),
        emailHint: emailHint(r.emailAddress),
        accountType: str(r.accountType),
        createdDate: isoOrNull(r.createdDate),
      };
    }),
  };
}

export function parseWireApplicationRoles(json: unknown): WireApplicationRole[] | null {
  const arr = Array.isArray(json) ? json : null;
  if (!arr) return null;
  return arr.map((role) => {
    const r = asRecord(role) ?? {};
    const details = Array.isArray(r.groupDetails) ? r.groupDetails : [];
    const detailIds = details
      .map((d) => str(asRecord(d)?.id))
      .filter((x): x is string => x !== null);
    const groupsArr = Array.isArray(r.groups) ? r.groups : [];
    const groupNames = groupsArr.filter((g): g is string => typeof g === 'string');
    return {
      roleKey: str(r.key),
      name: str(r.name),
      groupIds: detailIds.length > 0 ? detailIds : groupNames,
      userCount: numOrNull(r.userCount),
      numberOfSeats: numOrNull(r.numberOfSeats),
      remainingSeats: numOrNull(r.remainingSeats),
      hasUnlimitedSeats: boolOrNull(r.hasUnlimitedSeats),
    };
  });
}

export function parseWirePlans(json:unknown): WirePlanInfo[] | null {
  const rec = asRecord(json);
  if (!rec) return null;
  const applications = Array.isArray(rec.applications) ? rec.applications : null;
  if (!applications) return null;
  return applications.map((a) => {
    const r = asRecord(a) ?? {};
    return { applicationId: str(r.id), planRaw: str(r.plan) };
  });
}

export function parseWireSeatCount(json: unknown): WireSeatCount | null {
  const rec = asRecord(json);
  if (!rec) return null;
  return {
    total: numOrNull(rec.approximateLicenseCount),
    asOfHint: isoOrNull(rec.lastUpdated) ?? str(rec.cacheHint),
  };
}

export function parseWireIssueActivity(json: unknown): { values: WireIssueActivityHit[] } | null {
  const rec = asRecord(json);
  if (!rec) return null;
  const arr = Array.isArray(rec.issues) ? rec.issues : null;
  if (!arr) return null;
  return {
    values: arr.map((i) => {
      const r = asRecord(i) ?? {};
      const fields = asRecord(r.fields) ?? {};
      return {
        issueKey: str(r.key) ?? str(r.id),
        updated: isoOrNull(fields.updated),
        created: isoOrNull(fields.created),
        creatorAccountId: accountIdOf(fields.creator),
        assigneeAccountId: accountIdOf(fields.assignee),
        reporterAccountId: accountIdOf(fields.reporter),
      };
    }),
  };
}

export function parseWireContributions(json: unknown): { values: WireContributionHit[] } | null {
  const rec = asRecord(json);
  if (!rec) return null;
  const arr = Array.isArray(rec.results) ? rec.results : null;
  if (!arr) return null;
  return {
    values: arr.map((c) => {
      const r = asRecord(c) ?? {};
      const content = asRecord(r.content) ?? {};
      const version = asRecord(r.version) ?? {};
      return {
        contentId: str(content.id),
        lastModified: isoOrNull(version.when) ?? isoOrNull(r.lastModified),
        contributorAccountId: accountIdOf(r.contributorAccountIdFallback),
        creatorAccountId: accountIdOf(content.creatorAccountIdFallback),
      };
    }),
  };
}

/**
 * Confluence CQL search does not return per-user contributor accountIds in a
 * stable field; Atlas issues per-user queries (`contributor=accountid:...`),
 * so the hit itself is the evidence and identity fields are tolerated-null.
 */
export function contributionIdentityFromQuery(cqlAccountId: string): {
  contributorAccountId: string;
  creatorAccountId: string | null;
} {
  return { contributorAccountId: cqlAccountId, creatorAccountId: cqlAccountId };
}

export function parseWireOrgUsers(json: unknown): { values: WireOrgUser[] } | null {
  const rec = asRecord(json);
  if (!rec) return null;
  const arr = Array.isArray(rec.data) ? rec.data : null;
  if (!arr) return null;
  return {
    values: arr.map((u) => {
      const r = asRecord(u) ?? {};
      const access = Array.isArray(r.product_access) ? r.product_access : [];
      return {
        accountId: str(r.account_id) ?? str(r.accountId),
        accessBillable: boolOrNull(r.access_billable),
        lastActive: isoOrNull(r.last_active),
        addedToOrg: isoOrNull(r.added_to_org),
        productAccess: access.map((p) => {
          const pr = asRecord(p) ?? {};
          const pa: WireOrgProductAccess = {
            productId: str(pr.product_id) ?? str(pr.key),
            lastActive: isoOrNull(pr.last_active),
            accessBillable: boolOrNull(pr.access_billable),
          };
          return pa;
        }),
      };
    }),
  };
}

export function parseWireAppLicense(json: unknown): WireAppLicense | null {
  const rec = asRecord(json);
  if (!rec) return null;
  return {
    active: boolOrNull(rec.active),
    type: str(rec.type),
    isEvaluation: boolOrNull(rec.isEvaluation),
    subscriptionEndDate: isoOrNull(rec.subscriptionEndDate),
    capabilitySet: Array.isArray(rec.capabilitySet) ? rec.capabilitySet.filter((x): x is string => typeof x === 'string') : null,
  };
}
