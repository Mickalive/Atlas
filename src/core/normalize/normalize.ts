/**
 * Normalization: Wire DTOs -> canonical models.
 *
 * Tolerant by contract (ERR-6): malformed/absent upstream fields become null
 * and flow into explicit UNKNOWN handling downstream. This module contains no
 * transport, no activation-mode concept, and no sample-transport knowledge.
 */

import type {
  ApplicationRole,
  CanonicalUser,
  PlanName,
  ProductId,
  ProductPlanInfo,
} from '../types';
import type { PageMeta } from '../../gateway/types';

export interface NormalizedUser extends CanonicalUser {}

function normalizePlan(planRaw: string | null): PlanName {
  if (!planRaw) return 'UNKNOWN';
  const p = planRaw.toUpperCase();
  // The experimental license endpoint exposes only PAID/FREE; preserve that
  // granularity instead of inventing STANDARD/PREMIUM detail.
  if (p === 'PAID') return 'PAID';
  if (p === 'FREE') return 'FREE';
  if (['STANDARD', 'PREMIUM', 'ENTERPRISE'].includes(p)) return p as PlanName;
  return 'UNKNOWN';
}

/** Map a raw application id (e.g. "jira-servicedesk") to an Atlas product. */
export function productFromApplicationKey(key: string | null): ProductId | null {
  if (!key) return null;
  const k = key.toLowerCase();
  if (k.includes('jira-servicedesk') || k.includes('servicedesk')) return 'jsm';
  if (k.includes('jira-product-discovery')) return 'jpd';
  if (k.includes('confluence')) return 'confluence';
  if (k.includes('jira-software') || k.includes('jira-core') || k === 'jira' || k.includes('jira')) return 'jira';
  return null;
}

export function normalizeUser(wire: {
  accountId: string | null;
  displayName: string | null;
  active: boolean | null;
  emailHint: string | null;
  accountType: string | null;
  createdDate: string | null;
}): NormalizedUser | null {
  // An identity without any identifier cannot be anchored; skip but never fabricate one.
  if (!wire.accountId) return null;
  const serviceLike = isServiceAccountHeuristic(wire.emailHint, wire.accountType);
  return {
    accountId: wire.accountId,
    displayName: wire.displayName,
    emailHint: wire.emailHint,
    active: wire.active ?? true, // platform default when flag absent: assume present unless proven deactivated
    accountCreatedAt: wire.createdDate,
    accountType: serviceLike ? 'service_heuristic' : 'human',
  };
}

/**
 * Explainable service/technical-account heuristic (FP-09).
 * Deliberately simple and auditable: name/email markers only. A hit raises
 * protection (REVIEW floor); it never lowers it.
 */
const SERVICE_MARKERS = [
  'bot',
  'svc-',
  '-svc',
  'service-',
  '-service',
  'automation',
  'integration',
  'api-',
  '-api',
  'webhook',
  'ci-',
  '-ci',
  'build',
  'deploy',
];

export function isServiceAccountHeuristic(
  emailHint: string | null,
  accountType: string | null,
): boolean {
  if (accountType === 'app' || accountType === 'unknown-user-type-app') return true;
  if (!emailHint) return false;
  const local = emailHint.split('@')[0];
  return SERVICE_MARKERS.some((m) => local.startsWith(m) || local.endsWith(m) || local.includes(m));
}

/** Group-name pattern used ONLY as an admin-protection safety net (never for seat resolution). */
export function isAdminLikeGroupName(groupName: string | null): boolean {
  if (!groupName) return false;
  const n = groupName.toLowerCase();
  return (
    n.includes('admin') ||
    n.includes('administrator') ||
    n.includes('site-admin')
  );
}

export function normalizeApplicationRole(wire: {
  roleKey: string | null;
  name: string | null;
  groupIds: string[];
  userCount: number | null;
  numberOfSeats: number | null;
  remainingSeats: number | null;
  hasUnlimitedSeats: boolean | null;
}): ApplicationRole | null {
  if (!wire.roleKey) return null;
  return {
    roleKey: wire.roleKey,
    name: wire.name,
    groupIds: [...wire.groupIds].sort(),
    userCount: wire.userCount,
    numberOfSeats: wire.numberOfSeats,
    remainingSeats: wire.remainingSeats,
    hasUnlimitedSeats: wire.hasUnlimitedSeats,
  };
}

export function normalizePlans(wire: Array<{ applicationId: string | null; planRaw: string | null }>): ProductPlanInfo[] {
  return wire
    .map((w) => ({
      applicationId: w.applicationId ?? '',
      plan: normalizePlan(w.planRaw),
    }))
    .filter((p) => p.applicationId !== '');
}

export type { PageMeta };
