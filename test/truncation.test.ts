/**
 * SILENT-TRUNCATION REGRESSION (functional HIGH 5 repair).
 *
 * Pre-repair, metaFrom defaulted isLast to TRUE when a responder omitted
 * every pagination field: one 50-item page from a 120-user tenant reported
 * scan COMPLETE with usersAnalyzed=50 while 70 users were never acquired.
 * The engine-side defect is objective regardless of live payload shapes
 * (VERIFY-LIVE): an UNKNOWN continuation state must degrade the stream,
 * never present as COMPLETE.
 *
 * Repair contract:
 *  - Full page + NO pagination fields + no position echo => the responder
 *    gives us nothing to verify continuation with => stream DEGRADED
 *    ('pagination continuation unverifiable'), scan status PARTIAL.
 *  - Responder that ECHOES its position (startAt) gets probed forward until
 *    an empty/short page evidences termination => stream OK, COMPLETE, and
 *    every item actually acquired.
 *  - An offset-ignoring responder cannot spin the loop forever (fingerprint
 *    guard bounds the work and degrades honestly).
 */
import { describe, expect, it } from 'vitest';

import { memoryStorage } from '../src/backend/storage';
import { ScanService } from '../src/backend/scanService';
import { ForgeAtlassianGateway, type ForgeTransportRequest } from '../src/gateway/forge/forgeGateway';
import type { FinalReport } from '../src/core/types';

const NOW_MS = Date.parse('2026-08-26T12:00:00.000Z');
const iso = (daysAgo: number) => new Date(NOW_MS - daysAgo * 86_400_000).toISOString();

function synthUsers(n: number, prefix: string, start = 0) {
  return Array.from({ length: n }, (_, i) => ({
    accountId: `${prefix}-${String(start + i).padStart(3, '0')}`,
    displayName: `${prefix} ${start + i}`,
    active: true,
    emailAddress: `${prefix}${start + i}@corp.example`,
    accountType: null,
    createdDate: iso(900),
  }));
}

type Route = (req: ForgeTransportRequest) => { status: number; json: unknown } | null;

function baseRoutes(usersRoute: Route): Route[] {
  return [
    (req) =>
      req.path.startsWith('/rest/api/3/applicationrole')
        ? { status: 200, json: [{ key: 'jira-software', name: 'Jira Software', groupDetails: [{ id: 'g1' }], userCount: null, numberOfSeats: null, remainingSeats: null, hasUnlimitedSeats: null }] }
        : null,
    usersRoute,
    (req) => (req.path.startsWith('/rest/api/3/group/bulk') ? { status: 200, json: { values: [{ groupId: 'g1', name: 'Jira Users' }], startAt: 0, maxResults: 50, total: 1, isLast: true } } : null),
    (req) =>
      req.path.startsWith('/rest/api/3/group/member?')
        ? { status: 200, json: { values: [{ accountId: 'mem-1', displayName: 'M One', active: true, emailAddress: 'm1@corp.example', accountType: null, createdDate: iso(900) }], startAt: 0, maxResults: 50, isLast: true } }
        : null,
    (req) => (req.method === 'POST' && req.path.startsWith('/rest/api/3/search/jql') ? { status: 200, json: { issues: [] } } : null),
    // Healthy minimal Confluence surface so the ONLY degraded-stream variable
    // under test is Jira user pagination.
    (req) => (req.path.startsWith('/wiki/rest/api/group?') ? { status: 200, json: { results: [{ id: 'cg1', name: 'Confluence Users' }], start: 0, limit: 50, isLast: true } } : null),
    (req) =>
      /\/wiki\/rest\/api\/group\/[^/]+\/member/.test(req.path)
        ? { status: 200, json: { results: [{ account: { accountId: 'mem-1', displayName: 'M One', active: true, email: 'm1@corp.example', type: null } }], start: 0, limit: 50, isLast: true } }
        : null,
    (req) =>
      req.path.startsWith('/wiki/rest/api/search?')
        ? (() => {
            const cql = new URLSearchParams(req.path.split('?')[1]).get('cql') ?? '';
            const m = cql.match(/accountid:([^"\s]+)/);
            return m ? { status: 200, json: { results: [], start: 0, limit: 25, isLast: true } } : null;
          })()
        : null,
    (req) =>
      req.path.startsWith('/rest/api/3/license/approximateLicenseCount')
        ? { status: 200, json: { approximateLicenseCount: 10, lastUpdated: iso(0) } }
        : null,
  ];
}

async function runWith(routes: Route[], maxChunks = 40) {
  const gateway = new ForgeAtlassianGateway({
    transport: {
      async request(req) {
        for (const r of routes) {
          const hit = r(req);
          if (hit) return { status: hit.status, headers: {}, json: hit.json };
        }
        return { status: 404, headers: {}, json: null };
      },
    },
    sleepFn: async () => undefined,
    seed: 5,
  });
  const service = new ScanService({ gateway, dataMode: 'LIVE', storage: memoryStorage(), nowMs: () => NOW_MS, log: () => undefined });
  await service.ensureScan();
  let rec = await service.runChunk(60_000);
  let guard = 0;
  while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard++ < maxChunks) rec = await service.runChunk(60_000);
  return { rec, guard };
}

describe('HIGH 5 repair: unknown pagination continuation never presents as COMPLETE', () => {
  it('offset-ignoring responder returning full bare pages => DEGRADED stream + PARTIAL, bounded chunks', async () => {
    // Exactly-requested-size page, NO pagination fields anywhere, same content
    // forever: the audit's silent-truncation shape.
    const fullPage = { values: synthUsers(50, 'ghost') };
    const { rec, guard } = await runWith(baseRoutes((req) => (req.path.startsWith('/rest/api/3/users?') ? { status: 200, json: fullPage } : null)));
    expect(guard).toBeLessThan(40); // bounded work; no infinite spin
    expect(rec.status).toBe('PARTIAL');
    expect(rec.streams.jiraUsers.state).toBe('DEGRADED');
    expect(rec.streams.jiraUsers.reason ?? '').toMatch(/pagination continuation unverifiable/);
    expect((rec.report as FinalReport).status).toBe('PARTIAL');
  });

  it('a SHORT page against the requested size is evidenced termination => OK + COMPLETE', async () => {
    const shortPage = { values: synthUsers(7, 'tiny') };
    const { rec } = await runWith(baseRoutes((req) => (req.path.startsWith('/rest/api/3/users?') ? { status: 200, json: shortPage } : null)));
    expect(rec.streams.jiraUsers.state).toBe('OK');
    expect(rec.status).toBe('COMPLETE');
  });

  it('an EMPTY page after a bare full page still cannot prove continuation => honest PARTIAL', async () => {
    // Without a position echo we cannot distinguish "end of set" from
    // "responder ignoring our probe"; the conservative verdict stands even
    // though this particular responder was well-behaved.
    let call = 0;
    const pages = [{ values: synthUsers(50, 'batch') }, { values: [] }];
    const routes = baseRoutes((req) => (req.path.startsWith('/rest/api/3/users?') ? { status: 200, json: pages[Math.min(call++, pages.length - 1)] } : null));
    const { rec } = await runWith(routes);
    expect(rec.status).toBe('PARTIAL');
    expect(rec.streams.jiraUsers.reason ?? '').toMatch(/unverifiable/);
  });

  it('a position-echoing responder is probed to completion => everything acquired, COMPLETE', async () => {
    // Honors offsets and echoes startAt, but never sets isLast/total: the
    // strict-but-fair path. Probe must walk 120 users across 3 pages and end
    // on the definitive empty page.
    const total = 120;
    const served: number[] = [];
    const routes = baseRoutes((req) => {
      if (!req.path.startsWith('/rest/api/3/users?')) return null;
      const params = new URLSearchParams(req.path.split('?')[1]);
      const startAt = Number(params.get('startAt') ?? 0);
      const slice = synthUsers(Math.min(50, total - startAt), 'walk', startAt);
      served.push(startAt);
      return {
        status: 200,
        json: { values: slice, startAt, maxResults: 50 }, // echo, but NO isLast/total/token
      };
    });
    const { rec } = await runWith(routes);
    expect(rec.streams.jiraUsers.state).toBe('OK');
    expect(rec.status).toBe('COMPLETE');
    expect(rec.streams.jiraUsers.itemsFetched).toBe(total);
    expect(served.length).toBeGreaterThanOrEqual(3); // probed forward, not assumed complete
  });
});
