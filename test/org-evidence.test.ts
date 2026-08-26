/**
 * ORG-EVIDENCE MERGE REGRESSION (functional BLOCKER 2 repair).
 *
 * Pre-repair, orgSignalsForAccount pushed the org-wide last_active FIRST and
 * derive took positional [0], so a stale org-wide copy shadowed a fresh
 * product-specific observation and the conflicting-recent-signal screen never
 * saw it: "active 2 days ago" per the org API's own product_access yielded
 * SAFE_NOW.
 *
 * Repair contract: merge by MAX recency per product, and prove both at the
 * helper level and through the full classification path.
 */
import { describe, expect, it } from 'vitest';

import type { WireOrgUser } from '../src/gateway/types';
import { mergedOrgLastActiveForProduct } from '../src/core/evidence/evidence';
import { deriveReport, OBSERVATION_WINDOW_DAYS, type AcquisitionSnapshot } from '../src/core/pipeline/derive';
import { classifyAccount } from '../src/core/risk/classify';
import { buildPerUserActivity, buildUserProductEvidence } from '../src/core/evidence/evidence';

const NOW = '2026-08-26T12:00:00.000Z';
const iso = (daysAgo: number) => new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();

describe('mergedOrgLastActiveForProduct', () => {
  const orgUser: WireOrgUser = {
    accountId: 'acct-1',
    accessBillable: true,
    lastActive: iso(200), // org-wide: stale
    addedToOrg: iso(1000),
    productAccess: [
      { productId: 'jira-software', lastActive: iso(2), accessBillable: true }, // product-specific: fresh
    ],
  };

  it('takes the MAX-recency observation, never a positional first match', () => {
    expect(mergedOrgLastActiveForProduct(orgUser, 'jira')).toBe(iso(2));
  });

  it('falls back to the org-wide value when no product-specific row exists', () => {
    const onlyWide: WireOrgUser = { ...orgUser, productAccess: [] };
    expect(mergedOrgLastActiveForProduct(onlyWide, 'jira')).toBe(iso(200));
  });

  it('returns null when neither source observed anything', () => {
    const silent: WireOrgUser = { ...orgUser, lastActive: null, productAccess: [{ productId: 'jira-software', lastActive: null, accessBillable: true }] };
    expect(mergedOrgLastActiveForProduct(silent, 'jira')).toBeNull();
  });

  it('maps servicedesk/discovery/confluence product ids', () => {
    const multi: WireOrgUser = {
      ...orgUser,
      lastActive: null,
      productAccess: [
        { productId: 'jira-servicedesk', lastActive: iso(10), accessBillable: true },
        { productId: 'jira-product-discovery', lastActive: iso(11), accessBillable: true },
        { productId: 'confluence', lastActive: iso(12), accessBillable: true },
      ],
    };
    expect(mergedOrgLastActiveForProduct(multi, 'jsm')).toBe(iso(10));
    expect(mergedOrgLastActiveForProduct(multi, 'jpd')).toBe(iso(11));
    expect(mergedOrgLastActiveForProduct(multi, 'confluence')).toBe(iso(12));
  });
});

describe('BLOCKER 2 end-to-end: fresh product-specific org activity forces KEEP', () => {
  function snapshotWith(orgUser: WireOrgUser | null): AcquisitionSnapshot {
    return {
      scanId: 'scan-org-test',
      dataMode: 'LIVE',
      generatedAtIso: NOW,
      users: [
        { accountId: 'acct-p2', displayName: 'P Two', active: true, emailHint: null, accountType: null, createdDate: iso(900) },
      ],
      jiraMemberships: new Map([['g1', [{ accountId: 'acct-p2', displayName: null, active: null, emailHint: null, accountType: null, createdDate: null }]]]),
      jiraGroupNames: new Map([['g1', 'Jira Software Users']]),
      roles: [{ roleKey: 'jira-software', name: 'Jira Software', groupIds: ['g1'], userCount: 1, numberOfSeats: 10, remainingSeats: 0, hasUnlimitedSeats: false }],
      plansRaw: null,
      approxSeatTotals: { jira: 10 },
      issueActivityHits: [],
      issueActivityDrained: true,
      issueActivityDegradedReason: null,
      confluenceContributions: new Map(),
      confluenceGroupNames: new Map(),
      confluenceMembership: new Map(),
      orgUsersById: orgUser ? new Map([[orgUser.accountId!, orgUser]]) : null,
      streams: [],
      renewalConfig: { nextRenewalDate: null, exceptionAccountIds: [] },
    };
  }

  it('org says active 2d ago on the product while org-wide reads 200d stale -> KEEP, not SAFE_NOW', () => {
    const conflicting: WireOrgUser = {
      accountId: 'acct-p2',
      accessBillable: true,
      lastActive: iso(200),
      addedToOrg: iso(1000),
      productAccess: [{ productId: 'jira-software', lastActive: iso(2), accessBillable: true }],
    };
    const report = deriveReport(snapshotWith(conflicting));
    const rec = report.recommendations.find((r) => r.accountId === 'acct-p2');
    expect(rec!.risk.klass).toBe('KEEP');
    expect(rec!.why.ruleId).toBe('RULE_RECENT_ACTIVITY');
  });

  it('consistent org-wide staleness still corroborates toward SAFE_NOW (no capability loss)', () => {
    const consistent: WireOrgUser = {
      accountId: 'acct-p2',
      accessBillable: true,
      lastActive: iso(200),
      addedToOrg: iso(1000),
      productAccess: [{ productId: 'jira-software', lastActive: iso(200), accessBillable: true }],
    };
    const report = deriveReport(snapshotWith(consistent));
    const rec = report.recommendations.find((r) => r.accountId === 'acct-p2');
    expect(rec!.risk.klass).toBe('SAFE_NOW');
    expect(rec!.why.ruleId).toBe('RULE_CORROBORATED_STALENESS');
  });
});

/**
 * Direct classifier-level proof of the same rule ordering: the merged signal
 * must reach the conflicting-recent screen BEFORE any staleness corroboration.
 */
describe('classifier precedence with merged org signals', () => {
  it('a <90d merged org observation forces KEEP regardless of other stale surfaces', () => {
    const window = { windowStartIso: iso(OBSERVATION_WINDOW_DAYS), windowEndIso: NOW };
    const activity = buildPerUserActivity({ issueHits: [], jiraSweepComplete: true, jiraStreamDegraded: null, confluenceHitsByAccount: new Map() });
    const ev = buildUserProductEvidence({
      accountId: 'acct-x',
      productId: 'jira',
      holdsSeat: true,
      activity,
      window,
      orgLastActiveForProduct: iso(2), // merged max-recency result
      unavailableReason: null,
      confluenceSweepDrainedForAccount: false,
    });
    const cls = classifyAccount({
      accountId: 'acct-x',
      seats: [{ productId: 'jira', viaGroupIds: ['g1'], seatStatus: 'BILLABLE' }],
      evidence: new Map([['jira', ev]]),
      protection: { isAdminLike: false, adminViaGroupNames: [], isServiceHeuristic: false, isExplicitlyExempted: false, deactivated: false, accountCreatedAtIso: iso(900) },
      nowIso: NOW,
    });
    expect(cls.klass).toBe('KEEP');
    expect(cls.ruleId).toBe('RULE_RECENT_ACTIVITY');
  });
});
