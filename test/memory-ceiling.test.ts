/**
 * GATE-8 / ADV-5 — large-tenant memory ceiling.
 *
 * A 60k-seat tenant with deep pagination must derive within the Forge 512 MB
 * function budget. This test synthesizes an oversized AcquisitionSnapshot in
 * memory and asserts bounded heap growth and correct population counts
 * (streaming/batching semantics of the pure pipeline).
 */
import { describe, expect, it } from 'vitest';

import { deriveReport, type AcquisitionSnapshot } from '../src/core/pipeline/derive';
import type { WireIssueActivityHit, WireUser } from '../src/gateway/types';

const USERS = 60_000;
const ISSUE_HITS = 120_000;

function bigSnapshot(): AcquisitionSnapshot {
  const users: WireUser[] = [];
  for (let i = 0; i < USERS; i += 1) {
    users.push({
      accountId: `acc-${String(i).padStart(7, '0')}`,
      displayName: `User ${i}`,
      active: i % 50 !== 0,
      emailHint: i % 97 === 0 ? 'svc-bot@example.com' : `user${i}@example.com`,
      accountType: null,
      createdDate: new Date(Date.parse('2026-08-26T00:00:00Z') - 400 * 86_400_000).toISOString(),
    });
  }
  const issueActivityHits: WireIssueActivityHit[] = [];
  for (let i = 0; i < ISSUE_HITS; i += 1) {
    const acc = `acc-${String(i % USERS).padStart(7, '0')}`;
    issueActivityHits.push({
      issueKey: `ISSUE-${i}`,
      updated: new Date(Date.parse('2026-08-26T00:00:00Z') - (i % 170) * 86_400_000).toISOString(),
      created: new Date(Date.parse('2026-08-26T00:00:00Z') - (i % 170) * 86_400_000).toISOString(),
      creatorAccountId: acc,
      assigneeAccountId: null,
      reporterAccountId: null,
    });
  }
  const jiraMemberships = new Map<string, WireUser[]>();
  jiraMemberships.set('g-jira', users.map((u) => ({ ...u })));
  const confluenceContributions = new Map<string, { hits: never[]; complete: boolean }>();
  for (let i = 0; i < USERS; i += 2) {
    confluenceContributions.set(`acc-${String(i).padStart(7, '0')}`, { hits: [], complete: true });
  }

  return {
    scanId: 'scan-stress',
    dataMode: 'FIXTURE',
    generatedAtIso: '2026-08-26T12:00:00.000Z',
    users,
    jiraMemberships,
    jiraGroupNames: new Map([['g-jira', 'Jira Users']]),
    roles: [
      {
        roleKey: 'jira-software',
        name: 'Jira Software',
        groupIds: ['g-jira'],
        userCount: USERS,
        numberOfSeats: USERS + 10,
        remainingSeats: 10,
        hasUnlimitedSeats: false,
      },
    ],
    plansRaw: [{ applicationId: 'jira-software', planRaw: 'PAID' }],
    approxSeatTotals: { jira: USERS + 10 },
    issueActivityHits,
    issueActivityDrained: true,
    issueActivityDegradedReason: null,
    confluenceContributions,
    confluenceGroupNames: new Map(),
    confluenceMembership: new Map(),
    orgUsersById: null,
    streams: [
      { streamId: 'meta', state: 'OK', reason: null },
      { streamId: 'jiraUsers', state: 'OK', reason: null },
      { streamId: 'jiraGroups', state: 'OK', reason: null },
      { streamId: 'jiraGroupMembers', state: 'OK', reason: null },
      { streamId: 'confluenceGroups', state: 'OK', reason: null },
      { streamId: 'confluenceMembers', state: 'OK', reason: null },
      { streamId: 'issueSweep', state: 'OK', reason: null },
      { streamId: 'contributionQueries', state: 'OK', reason: null },
    ],
    renewalConfig: { nextRenewalDate: null, exceptionAccountIds: [] },
  };
}

describe('ADV-5 oversized tenant', () => {
  it('derives 60k users x 120k issue hits under the 512MB function budget', () => {
    const before = process.memoryUsage().heapUsed;
    const snap = bigSnapshot();
    const report = deriveReport(snap);
    const after = process.memoryUsage().heapUsed;

    expect(report.usersAnalyzed).toBeGreaterThan(USERS - 100);
    // Keep/unknown cards are capped; SAFE/REVIEW cards dominate here because
    // most users have recent activity (KEEP class) — cap applies to KEEP/UNKNOWN only.
    expect(report.recommendations.length).toBeLessThan(USERS);
    // Heap growth for the whole derivation stays comfortably inside budget headroom.
    const growthMb = (after - before) / (1024 * 1024);
    expect(growthMb).toBeLessThan(450);
    // Totals integrity at scale.
    const safeSum = report.recommendations
      .filter((r) => r.risk.klass === 'SAFE_NOW' && r.money)
      .reduce((a, r) => a + (r.money?.annualDeltaCents ?? 0), 0);
    expect(safeSum).toBe(report.totals.safeNowAnnualCents);
  }, 120_000);

  it('completes quickly enough to fit repeated scheduled chunks', () => {
    const start = Date.now();
    deriveReport(bigSnapshot());
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000); // far under a single 900s async budget
  }, 120_000);
});
