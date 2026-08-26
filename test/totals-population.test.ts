/**
 * POPULATION-TOTALS REGRESSION (functional HIGH 4 repair).
 *
 * Pre-repair, computeTotals recounted classes from the EMITTED card list,
 * which is capped at KEEP_UNKNOWN_CARD_CAP: 600 KEEP + 5 UNKNOWN analyzed
 * reported keepCount=500 / unknownCount=0 — the dashboard told admins there
 * were zero UNKNOWN accounts when five existed.
 *
 * Repair contract: KEEP/UNKNOWN counts come from the analysis population;
 * cards beyond the cap remain aggregated; money pools are unchanged.
 */
import { describe, expect, it } from 'vitest';

import { deriveReport, KEEP_UNKNOWN_CARD_CAP, type AcquisitionSnapshot } from '../src/core/pipeline/derive';
import { computeTotals } from '../src/core/recommend/recommend';
import type { WireIssueActivityHit, WireUser } from '../src/gateway/types';
import type { FinalReport } from '../src/core/types';

const NOW = '2026-08-26T12:00:00.000Z';
const iso = (daysAgo: number) => new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();

function wireUser(id: string, createdDaysAgo: number): WireUser {
  return { accountId: id, displayName: `User ${id}`, active: true, emailHint: null, accountType: null, createdDate: iso(createdDaysAgo) };
}

describe('HIGH 4 repair: totals count the population, not emitted cards', () => {
  const KEEP = 600;
  const UNKNOWN = 5;
  const SAFE = 3;

  const users: WireUser[] = [];
  for (let i = 0; i < KEEP; i += 1) users.push(wireUser(`keep-${String(i).padStart(4, '0')}`, 900));
  for (let i = 0; i < UNKNOWN; i += 1) users.push(wireUser(`unk-${i}`, 30)); // young account -> UNKNOWN
  for (let i = 0; i < SAFE; i += 1) users.push(wireUser(`safe-${i}`, 2200)); // old, never observed

  // Recent issue hits make the keep-* users genuinely KEEP.
  const issueHits: WireIssueActivityHit[] = users
    .filter((u) => u.accountId !== null && u.accountId.startsWith('keep-'))
    .map((u) => ({
      issueKey: `K-${u.accountId}`,
      updated: iso(10),
      created: iso(12),
      creatorAccountId: u.accountId,
      assigneeAccountId: null,
      reporterAccountId: u.accountId,
    }));

  const memberships = new Map<string, WireUser[]>([
    ['g1', users.map((u) => ({ accountId: u.accountId, displayName: null, active: null, emailHint: null, accountType: null, createdDate: null }))],
    ['g2', users.filter((u) => u.accountId !== null && u.accountId.startsWith('safe-')).map((u) => ({ accountId: u.accountId, displayName: null, active: null, emailHint: null, accountType: null, createdDate: null }))],
  ]);

  const snap: AcquisitionSnapshot = {
    scanId: 'scan-cap',
    dataMode: 'LIVE',
    generatedAtIso: NOW,
    users,
    jiraMemberships: memberships,
    jiraGroupNames: new Map([['g1', 'Jira Users'], ['g2', 'Confluence Users']]),
    roles: [{ roleKey: 'jira-software', name: 'Jira Software', groupIds: ['g1'], userCount: users.length, numberOfSeats: 1000, remainingSeats: 0, hasUnlimitedSeats: false }],
    plansRaw: null,
    approxSeatTotals: { jira: 1000 },
    issueActivityHits: issueHits,
    issueActivityDrained: true,
    issueActivityDegradedReason: null,
    confluenceContributions: new Map(), // safe-* hold only a jira seat here; absence map stays empty
    confluenceGroupNames: new Map(),
    confluenceMembership: new Map(),
    orgUsersById: null,
    streams: [],
    renewalConfig: { nextRenewalDate: null, exceptionAccountIds: [] },
  };

  it('608 analyzed -> totals.keepCount=600 and unknownCount=5 even though cards cap at 500', () => {
    const report = deriveReport(snap);
    expect(report.usersAnalyzed).toBe(KEEP + UNKNOWN + SAFE);
    expect(report.totals.keepCount).toBe(KEEP);
    expect(report.totals.unknownCount).toBe(UNKNOWN);
    // Emission cap still applies to the card list itself...
    const emittedKeepUnknown = report.recommendations.filter(
      (r) => r.risk.klass === 'KEEP' || r.risk.klass === 'UNKNOWN',
    ).length;
    expect(emittedKeepUnknown).toBeLessThanOrEqual(KEEP_UNKNOWN_CARD_CAP);
    // ...and sort order must not influence the counts anymore.
    expect(report.recommendations.length).toBeLessThan(users.length);
  });

  it('computeTotals honors explicit population overrides directly', () => {
    const totals = computeTotals({ recommendations: [], deactivatedExcludedCount: 0, protectedExcludedFromSafeNow: 0, populationKeepCount: 1234, populationUnknownCount: 42 });
    expect(totals.keepCount).toBe(1234);
    expect(totals.unknownCount).toBe(42);
  });

  it('without overrides computeTotals still recounts from cards (backwards-compatible)', () => {
    void (undefined as unknown as FinalReport | undefined);
    const rec = { risk: { klass: 'KEEP' } } as Parameters<typeof computeTotals>[0]['recommendations'][number];
    const totals = computeTotals({ recommendations: [rec], deactivatedExcludedCount: 0, protectedExcludedFromSafeNow: 0 });
    expect(totals.keepCount).toBe(1);
  });
});
