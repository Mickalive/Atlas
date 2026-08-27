/**
 * Usage-evidence builder.
 *
 * Consumes normalized inventory + activity observations and produces
 * per user x product evidence with explicit window coverage semantics:
 *  - A drained, permission-clean sweep with zero hits is a NEGATIVE_SWEEP
 *    observation (measured absence) — the only "absence" that corroborates.
 *  - Missing/malformed inputs set dataUnavailableReason and force UNKNOWN
 *    downstream (ERR-2/ERR-6, parity rule 9).
 */

import type {
  ActivitySignal,
  ProductId,
  SignalKind,
  UserProductEvidence,
} from '../types';
import type { WireContributionHit, WireIssueActivityHit, WireOrgUser } from '../../gateway/types';

export interface EvidenceWindow {
  windowStartIso: string;
  windowEndIso: string;
}

export interface PerUserActivity {
  /** accountId -> most recent positive observation instant per product. */
  byAccount: Map<string, Map<ProductId, { lastIso: string; kinds: Set<SignalKind>; sources: Set<string> }>>;
  /** AccountIds covered by a fully-drained Jira issue-activity sweep. */
  jiraSweepComplete: boolean;
  /** AccountIds covered by a fully-drained Confluence contribution sweep (per queried account). */
  confluenceSweptAccounts: Set<string>;
  /**
   * Accounts whose activity payloads arrived malformed/unparseable (ERR-6).
   * Their evidence must degrade to UNKNOWN, never to activity-absence.
   */
  malformedActivityAccounts: Set<string>;
  jiraStreamDegraded: string | null;
}

export function buildPerUserActivity(input: {
  issueHits: WireIssueActivityHit[];
  jiraSweepComplete: boolean;
  jiraStreamDegraded: string | null;
  confluenceHitsByAccount: Map<string, { hits: WireContributionHit[]; complete: boolean }>;
}): PerUserActivity {
  const byAccount = new Map<string, Map<ProductId, { lastIso: string; kinds: Set<SignalKind>; sources: Set<string> }>>();
  const malformedActivityAccounts = new Set<string>();
  const observe = (
    accountId: string | null,
    productId: ProductId,
    iso: string | null,
    kind: SignalKind,
    source: string,
  ) => {
    if (!accountId) return;
    if (iso !== null && !Number.isFinite(Date.parse(iso))) {
      // Unparseable timestamp on an identified hit: preserve as UNKNOWN (ERR-6).
      malformedActivityAccounts.add(accountId);
      return;
    }
    if (!iso) return;
    let perProduct = byAccount.get(accountId);
    if (!perProduct) {
      perProduct = new Map();
      byAccount.set(accountId, perProduct);
    }
    const existing = perProduct.get(productId);
    if (!existing) {
      perProduct.set(productId, { lastIso: iso, kinds: new Set([kind]), sources: new Set([source]) });
      return;
    }
    if (iso > existing.lastIso) existing.lastIso = iso;
    existing.kinds.add(kind);
    existing.sources.add(source);
  };

  for (const hit of input.issueHits) {
    const source = 'jira.search.jql';
    // Identity present but every temporal field unusable => malformed (ERR-6),
    // preserved explicitly instead of being treated as "never active".
    if ((hit.creatorAccountId || hit.assigneeAccountId || hit.reporterAccountId) && !hit.updated && !hit.created) {
      for (const id of [hit.creatorAccountId, hit.assigneeAccountId, hit.reporterAccountId]) {
        if (id) malformedActivityAccounts.add(id);
      }
      continue;
    }
    observe(hit.creatorAccountId, 'jira', hit.created, 'ISSUE_AUTHORSHIP', source);
    observe(hit.assigneeAccountId, 'jira', hit.updated ?? hit.created, 'ISSUE_ASSIGNMENT', source);
    observe(hit.reporterAccountId, 'jira', hit.updated ?? hit.created, 'ISSUE_AUTHORSHIP', source);
  }

  const confluenceSweptAccounts = new Set<string>();
  for (const [accountId, entry] of input.confluenceHitsByAccount) {
    confluenceSweptAccounts.add(accountId);
    for (const hit of entry.hits) {
      observe(
        accountId,
        'confluence',
        hit.lastModified,
        'CONFLUENCE_CONTRIBUTION',
        'confluence.search.cql',
      );
    }
  }

  return {
    byAccount,
    jiraSweepComplete: input.jiraSweepComplete,
    confluenceSweptAccounts,
    malformedActivityAccounts,
    jiraStreamDegraded: input.jiraStreamDegraded,
  };
}

export function orgSignalsForAccount(orgUser: WireOrgUser | null): ActivitySignal[] {
  if (!orgUser || !orgUser.accountId) return [];
  const signals: ActivitySignal[] = [];
  if (orgUser.lastActive) {
    signals.push({
      kind: 'ORG_LAST_ACTIVE',
      productId: null,
      lastObservedAt: orgUser.lastActive,
      observedThrough: orgUser.lastActive,
      source: 'org.api.users.last_active',
    });
  }
  for (const pa of orgUser.productAccess) {
    if (pa.productId && pa.lastActive) {
      const productId = mapOrgProductId(pa.productId);
      signals.push({
        kind: 'ORG_LAST_ACTIVE',
        productId,
        lastObservedAt: pa.lastActive,
        observedThrough: pa.lastActive,
        source: 'org.api.product_access.last_active',
      });
    }
  }
  return signals;
}

function mapOrgProductId(raw: string): ProductId | null {
  const k = raw.toLowerCase();
  if (k.includes('servicedesk')) return 'jsm';
  if (k.includes('product-discovery')) return 'jpd';
  if (k.includes('confluence')) return 'confluence';
  if (k.includes('jira')) return 'jira';
  return null;
}

/**
 * Effective org-side last-active for ONE product, merged by MAX recency
 * (functional BLOCKER 2): the org-wide `last_active` and the product-specific
 * `product_access[].last_active` are two observations of "user was active at
 * T"; the truthful merge for removal risk is the MOST RECENT one. Taking a
 * positional first match let a stale org-wide copy shadow a fresh
 * product-specific observation and mint false SAFE_NOW classifications.
 * Returns null only when neither source observed anything.
 */
export function mergedOrgLastActiveForProduct(
  orgUser: WireOrgUser | null,
  productId: ProductId,
): string | null {
  if (!orgUser || !orgUser.accountId) return null;
  const candidates: string[] = [];
  if (orgUser.lastActive) candidates.push(orgUser.lastActive);
  for (const pa of orgUser.productAccess) {
    if (pa.productId && pa.lastActive && mapOrgProductId(pa.productId) === productId) {
      candidates.push(pa.lastActive);
    }
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

/**
 * Build per user x product evidence for one account.
 * `sweepSemantics`: whether each product's negative sweep actually drained.
 */
export function buildUserProductEvidence(input: {
  accountId: string;
  productId: ProductId;
  holdsSeat: boolean;
  activity: PerUserActivity;
  window: EvidenceWindow;
  orgLastActiveForProduct: string | null;
  unavailableReason: string | null;
  confluenceSweepDrainedForAccount: boolean;
}): UserProductEvidence {
  const signals: ActivitySignal[] = [];
  const perProduct = input.activity.byAccount.get(input.accountId);

  if (input.productId === 'jira') {
    const obs = perProduct?.get('jira');
    if (obs) {
      // F-LOW 5: Emit one signal per observed kind for full evidence traceability.
      for (const kind of [...obs.kinds].sort()) {
        signals.push({
          kind,
          productId: 'jira',
          lastObservedAt: obs.lastIso,
          observedThrough: input.window.windowEndIso,
          source: [...obs.sources].sort().join('+'),
        });
      }
    }
    if (input.activity.jiraSweepComplete) {
      signals.push({
        kind: 'NEGATIVE_SWEEP_JIRA',
        productId: 'jira',
        lastObservedAt: obs ? obs.lastIso : null,
        observedThrough: input.window.windowEndIso,
        source: 'jira.search.jql#drained',
      });
    }
  }

  if (input.productId === 'confluence') {
    const obs = perProduct?.get('confluence');
    if (obs) {
      signals.push({
        kind: 'CONFLUENCE_CONTRIBUTION',
        productId: 'confluence',
        lastObservedAt: obs.lastIso,
        observedThrough: input.window.windowEndIso,
        source: 'confluence.search.cql',
      });
    }
    if (input.confluenceSweepDrainedForAccount) {
      signals.push({
        kind: 'NEGATIVE_SWEEP_CONFLUENCE',
        productId: 'confluence',
        lastObservedAt: obs ? obs.lastIso : null,
        observedThrough: input.window.windowEndIso,
        source: 'confluence.search.cql#drained',
      });
    }
  }

  if (input.orgLastActiveForProduct) {
    signals.push({
      kind: 'ORG_LAST_ACTIVE',
      productId: input.productId,
      lastObservedAt: input.orgLastActiveForProduct,
      observedThrough: input.window.windowEndIso,
      source: 'org.api',
    });
  }

  return {
    accountId: input.accountId,
    productId: input.productId,
    signals,
    coverage: {
      windowStart: input.window.windowStartIso,
      windowEnd: input.window.windowEndIso,
      complete: input.unavailableReason === null && windowIsComplete(input.window),
    },
    hasAnyPositiveSignal: signals.some((s) => !s.kind.startsWith('NEGATIVE_SWEEP')),
    dataUnavailableReason: input.unavailableReason,
  };
}

export function windowIsComplete(window: EvidenceWindow): boolean {
  // The pipeline only marks windows complete when acquisition says so; this
  // helper validates internal consistency of the window itself.
  return Date.parse(window.windowStartIso) < Date.parse(window.windowEndIso);
}

/** Days since last positive observation; null when never positively observed. */
export function daysSinceLastObservation(evidence: UserProductEvidence): number | null {
  const positives = evidence.signals.filter((s) => !s.kind.startsWith('NEGATIVE_SWEEP') && s.lastObservedAt);
  if (positives.length === 0) return null;
  const last = positives.map((s) => Date.parse(s.lastObservedAt as string)).reduce((a, b) => Math.max(a, b));
  const end = Date.parse(evidence.coverage.windowEnd);
  return Math.max(0, Math.floor((end - last) / 86_400_000));
}
