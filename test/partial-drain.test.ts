/**
 * PARTIAL-SWEEP MONEY REGRESSION (functional HIGH 3 repair).
 *
 * Pre-repair, a degraded issue sweep only forced dataUnavailableReason for
 * users WITHOUT prefix positives. A stale positive inside the drained prefix
 * kept coverage complete and classified SAFE_NOW with booked money — while up
 * to hundreds of undrained pages could hide the recent activity that would
 * force KEEP.
 *
 * Repair contract: an undrained Jira sweep degrades EVERY jira seat's
 * decision-grade coverage; genuinely recent users still KEEP via the
 * conflicting-recent screen (which runs earlier); stale-prefix users drop to
 * UNKNOWN and their money leaves the totals.
 */
import { describe, expect, it } from 'vitest';

import { memoryStorage } from '../src/backend/storage';
import { ScanService } from '../src/backend/scanService';
import { ForgeAtlassianGateway, type ForgeTransport, type ForgeTransportRequest } from '../src/gateway/forge/forgeGateway';
import type { FinalReport } from '../src/core/types';

const NOW_MS = Date.parse('2026-08-26T12:00:00.000Z');
const iso = (daysAgo: number) => new Date(NOW_MS - daysAgo * 86_400_000).toISOString();

const USERS = [
  { accountId: 'live-paula', displayName: 'Paula StalePrefix', emailAddress: 'paula@corp.example', active: true, createdDate: iso(900) },
  { accountId: 'live-recent', displayName: 'Rico RecentPrefix', emailAddress: 'rico@corp.example', active: true, createdDate: iso(900) },
  { accountId: 'live-old', displayName: 'Olga OldAccount', emailAddress: 'olga@corp.example', active: true, createdDate: iso(2200) },
];

function transportFor(sweepFirstPage: { json: unknown } | null, failAllContinuations: boolean): ForgeTransport {
  return {
    async request(req: ForgeTransportRequest) {
      const path = req.path;
      if (path.startsWith('/rest/api/3/applicationrole')) {
        return {
          status: 200,
          headers: {},
          json: [{ key: 'jira-software', name: 'Jira Software', groupDetails: [{ id: 'g1' }], userCount: 3, numberOfSeats: 10, remainingSeats: 0, hasUnlimitedSeats: false }],
        };
      }
      if (path.startsWith('/rest/api/3/users?')) {
        return { status: 200, headers: {}, json: { values: USERS.map((u) => ({ ...u, accountType: null })), startAt: 0, maxResults: 50, total: 3, isLast: true } };
      }
      if (path.startsWith('/rest/api/3/group/bulk')) {
        return { status: 200, headers: {}, json: { values: [{ groupId: 'g1', name: 'Jira Software Users' }], startAt: 0, maxResults: 50, total: 1, isLast: true } };
      }
      if (path.startsWith('/rest/api/3/group/member?')) {
        return { status: 200, headers: {}, json: { values: USERS.map((u) => ({ accountId: u.accountId, displayName: u.displayName, active: true, emailAddress: u.emailAddress, accountType: null, createdDate: u.createdDate })), startAt: 0, maxResults: 50, isLast: true } };
      }
      if (req.method === 'POST' && path.startsWith('/rest/api/3/search/jql')) {
        const continuing = Boolean((req.body as { nextPageToken?: string })?.nextPageToken);
        if (continuing && failAllContinuations) return { status: 500, headers: {}, json: null };
        if (!continuing && sweepFirstPage) return { status: 200, headers: {}, json: sweepFirstPage.json };
        return { status: 200, headers: {}, json: { issues: [] } };
      }
      // Confluence surface absent entirely (no groups): wiki calls 404.
      return { status: 404, headers: {}, json: null };
    },
  };
}

async function runScan(transport: ForgeTransport): Promise<{ report: FinalReport; streams: Record<string, { state: string; reason: string | null }> }> {
  const gateway = new ForgeAtlassianGateway({ transport, sleepFn: async () => undefined, seed: 11 });
  const service = new ScanService({
    gateway,
    dataMode: 'LIVE',
    storage: memoryStorage(),
    nowMs: () => NOW_MS,
    log: () => undefined,
  });
  await service.ensureScan();
  let rec = await service.runChunk(60_000);
  let guard = 0;
  while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard++ < 300) rec = await service.runChunk(60_000);
  expect(guard).toBeLessThan(300);
  expect(rec.report).toBeTruthy();
  return { report: rec.report!, streams: rec.streams as unknown as Record<string, { state: string; reason: string | null }> };
}

describe('HIGH-3 / HIGH-3b repair: partial sweeps cannot mint SAFE_NOW money', () => {
  it('HIGH-3: page1 of a declared larger set then HTTP 500 => stale-prefix user UNKNOWN, totals exclude them', async () => {
    const { report, streams } = await runScan(
      transportFor(
        {
          // Page 1: Paula stale hit (150d), Rico recent hit (10d). Declares more.
          json: {
            issues: [
              { key: 'P-1', fields: { creator: { accountId: 'live-paula' }, reporter: { accountId: 'live-paula' }, assignee: null, created: iso(150), updated: iso(150) } },
              { key: 'P-2', fields: { creator: { accountId: 'live-recent' }, reporter: { accountId: 'live-recent' }, assignee: null, created: iso(10), updated: iso(10) } },
            ],
            nextPageToken: 'cursor-page-2',
          },
        },
        true, // every continuation dies: up to 499 undrained pages
      ),
    );

    expect(streams.issueSweep.state).toBe('FAILED');
    expect(streams.issueSweep.reason).toMatch(/500/);

    const paula = report.recommendations.find((r) => r.accountId === 'live-paula');
    expect(paula!.risk.klass).toBe('UNKNOWN');
    expect(paula!.why.ruleId).toBe('RULE_DATA_UNAVAILABLE');

    // The recent-prefix user keeps KEEP via the conflicting-recent screen —
    // proven activity cannot be unmade by missing suffix data.
    const rico = report.recommendations.find((r) => r.accountId === 'live-recent');
    expect(rico!.risk.klass).toBe('KEEP');

    // NO safe-now savings may be booked from a half-drained sweep.
    expect(report.totals.safeNowAnnualCents).toBe(0);
    expect(report.status).toBe('PARTIAL');
  });

  it('HIGH-3b: a FULLY drained sweep with the same users books legitimate classifications (control)', async () => {
    const { report, streams } = await runScan(
      transportFor(
        {
          json: {
            issues: [
              { key: 'P-1', fields: { creator: { accountId: 'live-paula' }, reporter: { accountId: 'live-paula' }, assignee: null, created: iso(150), updated: iso(150) } },
              { key: 'P-2', fields: { creator: { accountId: 'live-recent' }, reporter: { accountId: 'live-recent' }, assignee: null, created: iso(10), updated: iso(10) } },
            ],
          },
        },
        false,
      ),
    );
    expect(streams.issueSweep.state).toBe('OK');
    const rico = report.recommendations.find((r) => r.accountId === 'live-recent');
    expect(rico!.risk.klass).toBe('KEEP');
    // Paula: single stale surface only (no confluence in this tenant) -> REVIEW at most.
    const paula = report.recommendations.find((r) => r.accountId === 'live-paula');
    expect(['REVIEW']).toContain(paula!.risk.klass);
  });
});
