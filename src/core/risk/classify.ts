/**
 * Risk classification engine.
 *
 * Deterministic rules ONLY. Conservative defaults frozen by PRODUCT_V1.md §4:
 *  - Inactivity >= 90 days => at best REVIEW (never automatically SAFE).
 *  - SAFE_NOW requires ALL of: strong-evidence corroboration rule, low
 *    dependency risk, FULL observation-window coverage, non-protected class,
 *    and no conflicting recent signal anywhere the user holds a seat.
 *  - Missing/unverifiable activity => UNKNOWN (BLK-1/ERR-2: absence of data
 *    must never produce or raise confidence toward SAFE).
 *  - Protected classes (admin-like groups, service-account heuristics,
 *    explicit exceptions) are structurally excluded from SAFE_NOW.
 *
 * This module is pure: no transport, no storage, no activation-mode concept.
 */

import type {
  DependencyCheck,
  ProductId,
  RiskClass,
  UserProductEvidence,
} from '../types';
import { daysSinceLastObservation } from '../evidence/evidence';

export interface RiskThresholds {
  /** Inactivity at/after which an account becomes a REVIEW candidate. */
  reviewAfterDays: number;
  /** Observation window the scan attempts to cover. */
  observationWindowDays: number;
}

export const DEFAULT_THRESHOLDS: RiskThresholds = {
  reviewAfterDays: 90,
  observationWindowDays: 180,
};

/** Account-level protection inputs, resolved upstream, explainable downstream. */
export interface ProtectionProfile {
  isAdminLike: boolean;
  adminViaGroupNames: string[];
  isServiceHeuristic: boolean;
  isExplicitlyExempted: boolean;
  deactivated: boolean;
  /** ISO creation date or null when unknown (unknown => never SAFE_NOW). */
  accountCreatedAtIso: string | null;
}

export interface SeatHolding {
  productId: ProductId;
  viaGroupIds: string[];
  seatStatus: 'BILLABLE' | 'FREE_TIER_ROLE' | 'UNKNOWN';
}

export interface ClassificationInput {
  accountId: string;
  seats: SeatHolding[];
  evidence: Map<ProductId, UserProductEvidence>;
  protection: ProtectionProfile;
  thresholds?: RiskThresholds;
  /** Injected "now" for determinism. */
  nowIso: string;
}

export interface ClassificationResult {
  klass: RiskClass;
  ruleId: string;
  thresholdSummary: string;
  detail: string;
  checks: DependencyCheck[];
  /**
   * Products eligible to be reclaimed under this classification (deduped,
   * money counted once per product regardless of group redundancy).
   */
  reclaimableProducts: ProductId[];
}

function daysBetween(isoA: string, isoB: string): number | null {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

export function classifyAccount(input: ClassificationInput): ClassificationResult {
  const th = input.thresholds ?? DEFAULT_THRESHOLDS;
  const checks: DependencyCheck[] = [];
  /**
   * Risk ANALYSIS covers every held seat/product — including seats whose
   * billing status is UNKNOWN (DEGRADED enumeration). Only RECLAIM ELIGIBILITY
   * (and therefore money) stays restricted to provably-billable seats.
   */
  const analyzedProducts = new Set(input.seats.map((s) => s.productId));
  const billableProducts = new Set(
    input.seats.filter((s) => s.seatStatus === 'BILLABLE').map((s) => s.productId),
  );

  // --- Platform deactivation -------------------------------------------------
  if (input.protection.deactivated) {
    return result('KEEP', 'RULE_DEACTIVATED', 'platform active=false', 'Account is already deactivated on the platform; it holds no removable billable seat, so claiming savings would fabricate value.', [
      ...checks,
      { check: 'DEACTIVATED_ACCOUNT', result: 'FAIL', detail: 'active=false' },
    ], []);
  }

  // --- Conflicting recent signal anywhere the user holds a seat --------------
  let conflicting: { productId: ProductId; days: number } | null = null;
  for (const productId of analyzedProducts) {
    const ev = input.evidence.get(productId);
    if (!ev) continue;
    const d = daysSinceLastObservation(ev);
    if (d !== null && d < th.reviewAfterDays && (!conflicting || d < conflicting.days)) {
      conflicting = { productId, days: d };
    }
  }
  if (conflicting) {
    return result(
      'KEEP',
      'RULE_RECENT_ACTIVITY',
      `positive activity ${conflicting.days}d ago (< ${th.reviewAfterDays}d threshold)`,
      `Observed human-contributed activity in ${conflicting.productId.toUpperCase()} within the last ${conflicting.days} days. Any recent activity signal forces KEEP.`,
      [...checks, { check: 'CONFLICTING_RECENT_SIGNAL', result: 'FAIL', detail: `${conflicting.productId} active ${conflicting.days}d ago` }],
      [],
    );
  }

  // --- Protected-class screens ----------------------------------------------
  const protectedHits: DependencyCheck[] = [];
  if (input.protection.isAdminLike) {
    protectedHits.push({
      check: 'ADMIN_LIKE_GROUP_PATTERN',
      result: 'FAIL',
      detail: `member of admin-pattern group(s): ${input.protection.adminViaGroupNames.join(', ')}`,
    });
  }
  if (input.protection.isServiceHeuristic) {
    protectedHits.push({
      check: 'SERVICE_ACCOUNT_HEURISTIC',
      result: 'FAIL',
      detail: 'name/email markers matched the explainable service-account pattern list',
    });
  }
  if (input.protection.isExplicitlyExempted) {
    protectedHits.push({
      check: 'EXCEPTION_LIST',
      result: 'FAIL',
      detail: 'account appears on the admin-managed explicit exception list',
    });
  }
  const isProtected = protectedHits.length > 0;

  // --- Evidence sufficiency --------------------------------------------------
  const relevantEvidence = [...analyzedProducts]
    .map((p) => input.evidence.get(p))
    .filter((e): e is UserProductEvidence => Boolean(e));

  const unavailable = relevantEvidence.find((e) => e.dataUnavailableReason !== null);
  if (unavailable) {
    return result(
      'UNKNOWN',
      'RULE_DATA_UNAVAILABLE',
      unavailable.dataUnavailableReason ?? 'data unavailable',
      `Activity data could not be established (${unavailable.dataUnavailableReason}). Missing data never lowers risk and never produces SAFE classifications.`,
      [...checks, ...protectedHits],
      [],
    );
  }

  const anyPositive = relevantEvidence.some((e) => e.hasAnyPositiveSignal);
  if (!anyPositive) {
    // No positive observation anywhere. Distinguish measured absence from
    // unverifiable absence.
    const windowComplete = relevantEvidence.every(
      (e) => e.coverage.complete && e.signals.some((s) => s.kind.startsWith('NEGATIVE_SWEEP')),
    );
    const ageDays = input.protection.accountCreatedAtIso
      ? daysBetween(input.protection.accountCreatedAtIso, input.nowIso)
      : null;

    if (ageDays === null || ageDays < th.observationWindowDays) {
      return result(
        'UNKNOWN',
        'RULE_INSUFFICIENT_OBSERVATION',
        ageDays === null ? 'account age unknown' : `account age ${ageDays}d < window ${th.observationWindowDays}d`,
        'No activity was ever observed, and the observation window cannot be proven to cover this account\u2019s lifetime. Never-observed accounts are UNKNOWN until the window provably spans their existence.',
        [...checks, ...protectedHits, { check: 'WINDOW_FULLY_COVERED', result: 'NOT_EVALUABLE', detail: 'account lifetime exceeds covered window?' }],
        [],
      );
    }

    const sweeps = relevantEvidence.filter((e) =>
      e.signals.some((s) => s.kind.startsWith('NEGATIVE_SWEEP')),
    );

    if (!windowComplete || sweeps.length === 0) {
      return result(
        'UNKNOWN',
        'RULE_NO_SIGNALS_WINDOW_INCOMPLETE',
        'no observations and incomplete sweep coverage',
        'Nothing was observed for this account, but the acquisition streams did not fully drain, so absence cannot be trusted.',
        [...checks, ...protectedHits, { check: 'WINDOW_FULLY_COVERED', result: 'NOT_EVALUABLE', detail: 'streams did not fully drain' }],
        [],
      );
    }

    if (isProtected) {
      return result(
        'REVIEW',
        'RULE_MEASURED_ABSENCE_PROTECTED',
        `zero observations across ${sweeps.length} drained sweep(s); protected class`,
        'Full-window sweeps found zero contributions, but the account matches a protected class (admin/service/exception). Protected accounts are structurally barred from SAFE_NOW.',
        [...checks, ...protectedHits],
        [],
      );
    }

    // Corroboration rule: >=2 independent drained sweeps required.
    if (sweeps.length >= 2) {
      return result(
        'SAFE_NOW',
        'RULE_CORROBORATED_ABSENCE',
        `zero observations in full ${th.observationWindowDays}d window across ${sweeps.length} independent products; account older than window`,
        `Two independent product surfaces were fully swept for the entire ${th.observationWindowDays}-day window and found zero contributions. The account predates the window, is non-protected, and shows no conflicting signal.`,
        [
          ...checks,
          { check: 'CORROBORATION_RULE', result: 'PASS', detail: `${sweeps.length} independent drained sweeps` },
          { check: 'WINDOW_FULLY_COVERED', result: 'PASS', detail: 'full window drained' },
          ...protectedHits,
        ],
        [...billableProducts],
      );
    }

    return result(
      'REVIEW',
      'RULE_SINGLE_SWEEP_ABSENCE',
      `zero observations in one fully-drained surface only`,
      'Absence was measured on exactly one product surface. A second independent surface is required before SAFE_NOW is possible.',
      [...checks, ...protectedHits, { check: 'CORROBORATION_RULE', result: 'FAIL', detail: 'only one drained sweep' }],
      [...billableProducts],
    );
  }

  // --- Positively observed but stale ----------------------------------------
  const stalest = relevantEvidence
    .map((e) => ({ productId: e.productId, days: daysSinceLastObservation(e) }))
    .filter((x): x is { productId: ProductId; days: number } => x.days !== null)
    .sort((a, b) => b.days - a.days);

  const windowComplete = relevantEvidence.every((e) => e.coverage.complete);
  const orgStrong = relevantEvidence.some((e) =>
    e.signals.some((s) => s.kind === 'ORG_LAST_ACTIVE' && s.lastObservedAt),
  );

  if (!windowComplete) {
    return result(
      'UNKNOWN',
      'RULE_WINDOW_INCOMPLETE',
      'acquisition window incomplete',
      'Positive signals exist but the scan window did not fully drain, so staleness cannot be bounded honestly.',
      [...checks, ...protectedHits, { check: 'WINDOW_FULLY_COVERED', result: 'FAIL', detail: 'partial drain' }],
      [],
    );
  }

  if (isProtected) {
    return result(
      'REVIEW',
      'RULE_STALE_PROTECTED',
      `last observed ${stalest[0]?.days ?? '?'}d ago; protected class`,
      'Long-stale activity combined with protected-class membership yields REVIEW only \u2014 admins/service/exempt accounts are never SAFE_NOW without an explicit recorded exception flow.',
      [...checks, ...protectedHits],
      [],
    );
  }

  const corroboratingStaleProducts = stalest.filter((s) => s.days >= th.reviewAfterDays);

  // Independent corroborating surfaces: positively-stale products plus
  // fully-drained negative sweeps on other held products (feasibility §4:
  // ">=2 independent product signals of long inactivity").
  const staleSurfaces = new Set(corroboratingStaleProducts.map((s) => s.productId));
  const negativeOnlySurfaces = relevantEvidence.filter(
    (e) => !staleSurfaces.has(e.productId) && !e.hasAnyPositiveSignal &&
      e.signals.some((s) => s.kind.startsWith('NEGATIVE_SWEEP')),
  );
  const corroboratingSurfaceCount = staleSurfaces.size + negativeOnlySurfaces.length;

  const strongCorroboration =
    (orgStrong && stalest.length > 0 && stalest.every((s) => s.days >= th.reviewAfterDays)) ||
    corroboratingSurfaceCount >= 2;

  if (strongCorroboration) {
    return result(
      'SAFE_NOW',
      'RULE_CORROBORATED_STALENESS',
      `${corroboratingSurfaceCount} independent surface(s) show >= ${th.reviewAfterDays}d inactivity${orgStrong ? '; org-admin last-active confirms' : ''}`,
      `Every held product shows no recent contribution for >= ${th.reviewAfterDays} days${orgStrong ? ', corroborated by organization-level last-active data' : ' across independent product surfaces'}, with full window coverage and no protected-class hit.`,
      [
        ...checks,
        { check: 'CORROBORATION_RULE', result: 'PASS', detail: `${corroboratingSurfaceCount} independent surfaces${negativeOnlySurfaces.length > 0 ? ` (incl. ${negativeOnlySurfaces.length} drained absence sweep(s))` : ''}${orgStrong ? ' + org last-active' : ''}` },
        { check: 'WINDOW_FULLY_COVERED', result: 'PASS', detail: 'full window drained' },
        ...protectedHits,
      ],
      [...billableProducts],
    );
  }

  return result(
    'REVIEW',
    'RULE_SINGLE_SURFACE_STALE',
    `last observed ${stalest[0]?.days ?? '?'}d ago (< 2 corroborating surfaces)`,
    'One product surface shows long inactivity. Per policy, 90+ day inactivity alone reaches at most REVIEW pending corroboration.',
    [...checks, ...protectedHits, { check: 'CORROBORATION_RULE', result: 'FAIL', detail: 'single stale surface' }],
    [...billableProducts],
  );
}

function result(
  klass: RiskClass,
  ruleId: string,
  thresholdSummary: string,
  detail: string,
  checks: DependencyCheck[],
  reclaimableProducts: ProductId[],
): ClassificationResult {
  return { klass, ruleId, thresholdSummary, detail, checks, reclaimableProducts };
}
