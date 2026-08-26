/**
 * Scan derivation pipeline (pure).
 *
 * Consumes an AcquisitionSnapshot collected through the Atlas gateway
 * interface and produces the FinalReport. Identical downstream code runs for
 * production and sample-data acquisitions — there is deliberately no way to
 * branch on transport origin here.
 */

import type {
  ActivitySignal,
  DataMode,
  FinalReport,
  PlanName,
  ProductId,
  Recommendation,
  RenewalConfig,
  StreamTelemetry,
  UserProductEvidence,
} from '../types';
import type {
  WireApplicationRole,
  WireContributionHit,
  WireIssueActivityHit,
  WireOrgUser,
  WireUser,
} from '../../gateway/types';
import {
  isAdminLikeGroupName,
  normalizeApplicationRole,
  normalizePlans,
  normalizeUser,
  productFromApplicationKey,
} from '../normalize/normalize';
import type { NormalizedUser } from '../normalize/normalize';
import {
  buildPerUserActivity,
  buildUserProductEvidence,
  mergedOrgLastActiveForProduct,
  type EvidenceWindow,
} from '../evidence/evidence';
import {
  classifyAccount,
  DEFAULT_THRESHOLDS,
  type ProtectionProfile,
  type SeatHolding,
} from '../risk/classify';
import { buildRecommendation, computeTotals } from '../recommend/recommend';

export const OBSERVATION_WINDOW_DAYS = 180;

/**
 * KEEP/UNKNOWN cards beyond this cap are aggregated as counts only. Every
 * EMITTED card still satisfies FP-S2 completeness; totals always reflect the
 * full population.
 */
export const KEEP_UNKNOWN_CARD_CAP = 500;

export interface StreamAcquisition {
  streamId: string;
  state: 'OK' | 'DEGRADED' | 'FAILED';
  reason: string | null;
}

export interface AcquisitionSnapshot {
  scanId: string;
  dataMode: DataMode;
  generatedAtIso: string;
  users: WireUser[];
  /** Jira group id -> member list (drained). */
  jiraMemberships: Map<string, WireUser[]>;
  jiraGroupNames: Map<string, string>;
  roles: WireApplicationRole[];
  plansRaw: Array<{ applicationId: string | null; planRaw: string | null }> | null;
  approxSeatTotals: Partial<Record<ProductId, number | null>>;
  issueActivityHits: WireIssueActivityHit[];
  /** True only when the site-wide issue-activity sweep fully drained. */
  issueActivityDrained: boolean;
  issueActivityDegradedReason: string | null;
  /** Per-account Confluence contribution queries (bounded candidate set). */
  confluenceContributions: Map<string, { hits: WireContributionHit[]; complete: boolean }>;
  confluenceGroupNames: Map<string, string>;
  confluenceMembership: Map<string, WireUser[]>;
  orgUsersById: Map<string, WireOrgUser> | null;
  streams: StreamAcquisition[];
  renewalConfig: RenewalConfig;
}

export interface DeriveOptions {
  thresholds?: typeof DEFAULT_THRESHOLDS;
}

function daysBetween(aIso: string, bIso: string): number {
  return Math.floor((Date.parse(bIso) - Date.parse(aIso)) / 86_400_000);
}

export function planScanWindow(nowIso: string, days = OBSERVATION_WINDOW_DAYS): EvidenceWindow {
  return {
    windowStartIso: new Date(Date.parse(nowIso) - days * 86_400_000).toISOString(),
    windowEndIso: nowIso,
  };
}

interface UserAnalysis {
  user: NormalizedUser;
  seats: SeatHolding[];
  accessPaths: string[];
  adminViaGroupNames: string[];
  confluenceCandidate: boolean;
  confluenceSweepDrained: boolean;
}

export function deriveReport(snap: AcquisitionSnapshot, options?: DeriveOptions): FinalReport {
  const th = options?.thresholds ?? DEFAULT_THRESHOLDS;
  const window = planScanWindow(snap.generatedAtIso, th.observationWindowDays);

  // --- normalize -------------------------------------------------------------
  const users: NormalizedUser[] = [];
  for (const wu of snap.users) {
    const n = normalizeUser(wu);
    if (n) users.push(n);
  }
  // Canonical identity dedupe: first occurrence wins; later duplicates are
  // dropped so phantom extra seats cannot appear (FP-26).
  const seen = new Set<string>();
  const uniqueUsers = users.filter((u) => {
    if (seen.has(u.accountId)) return false;
    seen.add(u.accountId);
    return true;
  });

  const roles = snap.roles
    .map(normalizeApplicationRole)
    .filter((r): r is NonNullable<ReturnType<typeof normalizeApplicationRole>> => r !== null);

  const plans = snap.plansRaw ? normalizePlans(snap.plansRaw) : [];

  // --- membership maps ---------------------------------------------------------
  const groupsOfJiraUser = new Map<string, Set<string>>();
  for (const [groupId, members] of snap.jiraMemberships) {
    for (const m of members) {
      if (!m.accountId) continue;
      let set = groupsOfJiraUser.get(m.accountId);
      if (!set) {
        set = new Set();
        groupsOfJiraUser.set(m.accountId, set);
      }
      set.add(groupId);
    }
  }
  const groupsOfConfUser = new Map<string, Set<string>>();
  const confMembersAll = new Map<string, boolean>();
  for (const [groupId, members] of snap.confluenceMembership) {
    for (const m of members) {
      if (!m.accountId) continue;
      let set = groupsOfConfUser.get(m.accountId);
      if (!set) {
        set = new Set();
        groupsOfConfUser.set(m.accountId, set);
      }
      set.add(groupId);
      confMembersAll.set(m.accountId, true);
    }
  }

  // Role -> product resolution (never hard-coded default group names).
  const roleProducts = new Map<string, ProductId>();
  for (const role of roles) {
    const p = productFromApplicationKey(role.roleKey);
    if (p) roleProducts.set(role.roleKey, p);
  }
  const groupToRoles = new Map<string, string[]>();
  for (const role of roles) {
    for (const gid of role.groupIds) {
      const arr = groupToRoles.get(gid) ?? [];
      arr.push(role.roleKey);
      groupToRoles.set(gid, arr);
    }
  }

  const exempted = new Set(snap.renewalConfig.exceptionAccountIds);

  // --- per-user analysis -------------------------------------------------------
  const analyses: UserAnalysis[] = [];
  const allAccountIds = new Set<string>([...uniqueUsers.map((u) => u.accountId), ...confMembersAll.keys()]);

  for (const accountId of [...allAccountIds].sort()) {
    const user = uniqueUsers.find((u) => u.accountId === accountId);
    const jiraGroups = groupsOfJiraUser.get(accountId) ?? new Set<string>();
    const confGroups = groupsOfConfUser.get(accountId) ?? new Set<string>();

    const seats: SeatHolding[] = [];
    const accessPaths: string[] = [];
    const productsSeen = new Map<ProductId, string[]>();
    const adminViaGroupNames: string[] = [];

    for (const gid of jiraGroups) {
      const gname = snap.jiraGroupNames.get(gid) ?? null;
      if (isAdminLikeGroupName(gname)) adminViaGroupNames.push(`jira:${gname}`);
      const roleKeys = groupToRoles.get(gid) ?? [];
      for (const rk of roleKeys) {
        const productId = roleProducts.get(rk);
        if (!productId) continue;
        accessPaths.push(`${productId}<-${snap.jiraGroupNames.get(gid) ?? gid}`);
        const arr = productsSeen.get(productId) ?? [];
        arr.push(gid);
        productsSeen.set(productId, arr);
      }
    }
    for (const [productId, gids] of productsSeen) {
      seats.push({ productId, viaGroupIds: [...gids].sort(), seatStatus: 'BILLABLE' });
    }

    let confluenceCandidate = false;
    for (const gid of confGroups) {
      const gname = snap.confluenceGroupNames.get(gid) ?? null;
      if (isAdminLikeGroupName(gname)) adminViaGroupNames.push(`confluence:${gname}`);
      if (!productsSeen.has('confluence')) {
        confluenceCandidate = true;
        accessPaths.push(`confluence<-${snap.confluenceGroupNames.get(gid) ?? gid}`);
      }
    }
    if (confluenceCandidate) {
      // Feasibility §3.2: Confluence paid-seat enumeration is DEGRADED —
      // candidates come from groups; seat status stays UNKNOWN.
      seats.push({ productId: 'confluence', viaGroupIds: [...confGroups].sort(), seatStatus: 'UNKNOWN' });
    }

    const confluenceEntry = snap.confluenceContributions.get(accountId);
    analyses.push({
      user: user ?? {
        accountId,
        displayName: null,
        emailHint: null,
        active: true,
        accountCreatedAt: null,
        accountType: 'unknown',
      },
      seats,
      accessPaths: [...accessPaths].sort(),
      adminViaGroupNames,
      confluenceCandidate,
      confluenceSweepDrained: confluenceEntry?.complete ?? false,
    });
  }

  // --- evidence ------------------------------------------------------------------
  const activity = buildPerUserActivity({
    issueHits: snap.issueActivityHits,
    jiraSweepComplete: snap.issueActivityDrained,
    jiraStreamDegraded: snap.issueActivityDegradedReason,
    confluenceHitsByAccount: snap.confluenceContributions,
  });

  // Tenant-level billable seat baselines (for scenario math), most-defensible first.
  const billableSeatsByProduct: Partial<Record<ProductId, number>> = {};
  for (const [productIdRaw, approx] of Object.entries(snap.approxSeatTotals)) {
    const productId = productIdRaw as ProductId;
    if (typeof approx === 'number') billableSeatsByProduct[productId] = approx;
  }

  // --- classify + recommend -------------------------------------------------------
  const recommendations: Recommendation[] = [];
  let keepCount = 0;
  let unknownCount = 0;
  let deactivatedCount = 0;
  let protectedStuckAtReview = 0;
  let keepUnknownEmitted = 0;

  for (const a of analyses) {
    if (a.seats.length === 0) continue;

    const evidenceMap = new Map<ProductId, UserProductEvidence>();
    for (const seat of a.seats) {
      const orgUser = snap.orgUsersById?.get(a.user.accountId) ?? null;
      // Org-wide and product-specific last-active merged by MAX recency per
      // product — never positional selection (functional BLOCKER 2).
      const orgLastActive = mergedOrgLastActiveForProduct(orgUser, seat.productId);

      let unavailableReason: string | null = null;
      if (activity.malformedActivityAccounts.has(a.user.accountId)) {
        unavailableReason = 'malformed activity payload preserved as unknown (ERR-6)';
      } else if (
        seat.productId === 'jira' &&
        !activity.jiraSweepComplete &&
        snap.issueActivityDegradedReason
      ) {
        // Degraded/undrained Jira sweep: EVERY jira seat loses decision-grade
        // coverage, including seats with prefix hits — the undrained remainder
        // may hide recent activity that would force KEEP (functional HIGH 3).
        // Genuinely recent users still reach KEEP earlier via the
        // conflicting-recent-signal screen, which runs before this degrades
        // anything; what is removed is SAFE_NOW-from-stale-prefix.
        unavailableReason = `jira activity stream degraded: ${snap.issueActivityDegradedReason}`;
      } else if (seat.productId === 'confluence' && !snap.confluenceContributions.has(a.user.accountId)) {
        unavailableReason = 'confluence contribution query not performed (outside bounded candidate set or stream unavailable)';
      }

      const ev = buildUserProductEvidence({
        accountId: a.user.accountId,
        productId: seat.productId,
        holdsSeat: true,
        activity,
        window,
        orgLastActiveForProduct: orgLastActive,
        unavailableReason,
        confluenceSweepDrainedForAccount: a.confluenceSweepDrained,
      });
      evidenceMap.set(seat.productId, ev);
    }

    const protection: ProtectionProfile = {
      isAdminLike: a.adminViaGroupNames.length > 0,
      adminViaGroupNames: a.adminViaGroupNames,
      isServiceHeuristic: a.user.accountType === 'service_heuristic',
      isExplicitlyExempted: exempted.has(a.user.accountId),
      deactivated: !a.user.active,
      accountCreatedAtIso: a.user.accountCreatedAt,
    };

    const cls = classifyAccount({
      accountId: a.user.accountId,
      seats: a.seats,
      evidence: evidenceMap,
      protection,
      thresholds: th,
      nowIso: snap.generatedAtIso,
    });

    const evidenceLines: Recommendation['evidence'] = [];
    for (const seat of a.seats) {
      const ev = evidenceMap.get(seat.productId);
      if (!ev) continue;
      for (const s of ev.signals) {
        evidenceLines.push({
          kind: s.kind,
          source: s.source,
          observedAt: s.lastObservedAt,
          detail:
            s.kind.startsWith('NEGATIVE_SWEEP') && s.lastObservedAt === null
              ? `full-window sweep ${window.windowStartIso}..${window.windowEndIso} found zero observations`
              : `last observed ${s.lastObservedAt}`,
        });
      }
    }
    evidenceLines.push({
      kind: 'GROUP_MEMBERSHIP',
      source: 'applicationrole+group.member',
      observedAt: null,
      detail: `seat paths: ${a.accessPaths.join(', ')}`,
    });
    evidenceLines.push({
      kind: 'PLATFORM_ACTIVE_FLAG',
      source: 'users endpoint',
      observedAt: null,
      detail: a.user.active ? 'active=true' : 'active=false (deactivated)',
    });

    if (cls.klass === 'KEEP') keepCount += 1;
    if (cls.klass === 'UNKNOWN') unknownCount += 1;
    if (!a.user.active) deactivatedCount += 1;
    if (cls.ruleId.endsWith('_PROTECTED')) protectedStuckAtReview += 1;

    const shouldEmitCard =
      cls.klass === 'SAFE_NOW' ||
      cls.klass === 'REVIEW' ||
      keepUnknownEmitted < KEEP_UNKNOWN_CARD_CAP;
    if (cls.klass === 'KEEP' || cls.klass === 'UNKNOWN') keepUnknownEmitted += 1;

    if (shouldEmitCard) {
      recommendations.push(
        buildRecommendation({
          scanId: snap.scanId,
          dataMode: snap.dataMode,
          accountId: a.user.accountId,
          displayName: a.user.displayName,
          accessPaths: a.accessPaths,
          classification: cls,
          billableSeatsByProduct,
          evidenceLines,
          todayIso: snap.generatedAtIso,
        }),
      );
    }
  }

  // --- finalize -------------------------------------------------------------------
  const streams: StreamTelemetry[] = snap.streams.map((s) => ({
    ...s,
    pagesFetched: 0,
    itemsFetched: 0,
    httpFailures: [],
  }));
  const allOk = streams.every((s) => s.state === 'OK');
  const status: FinalReport['status'] = allOk ? 'COMPLETE' : 'PARTIAL';

  const plansByProduct: Record<string, PlanName> = {};
  for (const p of plans) {
    const pid = productFromApplicationKey(p.applicationId);
    if (pid) plansByProduct[pid] = p.plan;
  }

  const renewalDays = snap.renewalConfig.nextRenewalDate
    ? Math.max(0, daysBetween(snap.generatedAtIso, snap.renewalConfig.nextRenewalDate))
    : null;

  const usedVersions = new Set<string>();
  const effectiveDates = new Set<string>();
  if (Object.keys(billableSeatsByProduct).some((p) => p === 'jira')) {
    usedVersions.add('jira-standard-monthly-2026H2');
    effectiveDates.add('2026-08-26');
  }

  // Totals count the ANALYSIS POPULATION, not the emitted card list: KEEP/
  // UNKNOWN emission is capped, and recounting from capped cards understated
  // collapsed counts (functional HIGH 4). Money pools are still exact sums
  // over emitted recommendations — SAFE_NOW/REVIEW always emit.
  const totals = computeTotals({
    recommendations,
    deactivatedExcludedCount: deactivatedCount,
    protectedExcludedFromSafeNow: protectedStuckAtReview,
    populationKeepCount: keepCount,
    populationUnknownCount: unknownCount,
  });

  return {
    scanId: snap.scanId,
    dataMode: snap.dataMode,
    generatedAt: snap.generatedAtIso,
    window: {
      windowStart: window.windowStartIso,
      windowEnd: window.windowEndIso,
      windowDays: th.observationWindowDays,
    },
    status,
    streams,
    productsScanned: [...new Set(analyses.flatMap((a) => a.seats.map((s) => s.productId)))].sort(),
    plans: plansByProduct,
    approxSeatCounts: Object.fromEntries(
      Object.entries(snap.approxSeatTotals).map(([k, v]) => [
        k,
        { total: v ?? null, asOfHint: 'license metrics cache may lag up to 7 days' },
      ]),
    ) as FinalReport['approxSeatCounts'],
    pricing: {
      modelVersionsUsed: [...usedVersions],
      datasetEffectiveDates: [...effectiveDates],
      assumptions: [
        'All figures are ESTIMATES from published list-price snapshots; real invoices depend on negotiated discounts and taxes.',
        'Monthly progressive billing follows peak seats (MQB): reductions realize from the next billing period.',
        'Annual commitments realize savings at the next renewal event.',
        'Paid plans bill a documented minimum seat floor where applicable.',
        'Approximate license counts can lag up to 7 days.',
        'Confluence seat enumeration is group-derived; seat status is UNKNOWN without organization enrichment.',
        'JPD contributor seats have no verified REST source; no JPD seat savings are claimed.',
      ],
      staleDatasets: [],
    },
    usersAnalyzed: analyses.filter((a) => a.seats.length > 0).length,
    recommendations,
    totals,
    renewal: {
      nextRenewalDate: snap.renewalConfig.nextRenewalDate,
      daysToRenewal: renewalDays,
      exposureUntilRenewalNote: renewalDays !== null
        ? `T-minus ${renewalDays} days to renewal. SAFE NOW items removed before renewal reduce the next invoice directly; review-pool items require human confirmation first.`
        : null,
    },
  };
}

