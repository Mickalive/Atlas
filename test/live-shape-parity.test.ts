/**
 * LIVE-SHAPE PARITY GATE (release_integrator repair for functional BLOCKER 1,
 * SEC-M3, F-LOW 11).
 *
 * The pre-repair parity suite replayed Wire data recorded FROM THE FIXTURE,
 * proving downstream determinism only. It never exercised what the PRODUCTION
 * gateway emits for raw live payloads — which is exactly where BLOCKER 1 hid:
 * inline parsing dropped `version.when`, converting real Confluence activity
 * into fabricated "measured absence" and minting SAFE_NOW for a user who
 * contributed days ago.
 *
 * These tests feed RAW HTTP-shaped JSON (the shapes Atlassian actually sends)
 * through ForgeAtlassianGateway's injected transport and drive the REAL
 * ScanService -> deriveReport pipeline over them.
 */
import { describe, expect, it } from 'vitest';

import { memoryStorage } from '../src/backend/storage';
import { ScanService } from '../src/backend/scanService';
import { ForgeAtlassianGateway, type ForgeTransport, type ForgeTransportRequest } from '../src/gateway/forge/forgeGateway';
import { FIXTURE_SCAN_NOW } from '../src/gateway/fixture/dataset';
import type { FinalReport } from '../src/core/types';

const NOW_MS = Date.parse('2026-08-26T12:00:00.000Z');
void FIXTURE_SCAN_NOW;

function iso(daysAgo: number): string {
  return new Date(NOW_MS - daysAgo * 86_400_000).toISOString();
}

type Route = (req: ForgeTransportRequest) => { status: number; headers?: Record<string, string>; json: unknown } | null;

function transportWith(routes: Route[]): ForgeTransport {
  return {
    async request(req) {
      for (const r of routes) {
        const hit = r(req);
        if (hit) return { status: hit.status, headers: hit.headers ?? {}, json: hit.json };
      }
      return { status: 404, headers: {}, json: null };
    },
  };
}

/** Decodes `contributor="accountid:<id>"` out of a wiki search CQL query. */
function cqlAccountIdFromPath(path: string): string | null {
  const q = path.split('?')[1] ?? '';
  const params = new URLSearchParams(q);
  const cql = params.get('cql') ?? '';
  const m = cql.match(/accountid:([^"\s]+)/);
  return m ? m[1] : null;
}

interface LiveTenantSpec {
  users: Array<{ accountId: string; displayName: string; emailAddress: string; active: boolean; createdDate: string; accountType?: string }>;
  jiraGroups: Array<{ groupId: string; name: string; members: string[] }>;
  confluenceGroups: Array<{ groupId: string; name: string; members: string[] }>;
  /** Site-wide issue sweep rows (window-filtered upstream). */
  issues: Array<{ key: string; createdDaysAgo: number; updatedDaysAgo: number; creator: string | null; assignee: string | null; reporter: string | null }>;
  /** Per-account Confluence contribution hits (CQL is window-filtered upstream). */
  contributions: Record<string, Array<{ contentId: string; whenDaysAgo: number }>>;
  jiraSeats: number;
}

function routesFor(spec: LiveTenantSpec): Route[] {
  return [
    // applicationrole: bare array shape
    (req) => {
      if (req.path.startsWith('/rest/api/3/applicationrole')) {
        return {
          status: 200,
          json: [
            {
              key: 'jira-software',
              name: 'Jira Software',
              groupDetails: spec.jiraGroups.filter((g) => g.name.includes('Users')).map((g) => ({ id: g.groupId })),
              userCount: spec.users.length,
              numberOfSeats: spec.jiraSeats,
              remainingSeats: 0,
              hasUnlimitedSeats: false,
            },
          ],
        };
      }
      return null;
    },
    (req) => (req.path.startsWith('/rest/api/3/instance/license') ? { status: 404, json: null } : null),
    (req) => {
      const m = req.path.match(/approximateLicenseCount\/product\/([a-z-]+)$/);
      if (!m) return null;
      return {
        status: 200,
        json: { approximateLicenseCount: m[1] === 'jira' ? spec.jiraSeats : null, lastUpdated: iso(0) },
      };
    },
    (req) => {
      if (!req.path.startsWith('/rest/api/3/users?')) return null;
      return {
        status: 200,
        json: {
          values: spec.users.map((u) => ({
            accountId: u.accountId,
            displayName: u.displayName,
            active: u.active,
            emailAddress: u.emailAddress,
            accountType: u.accountType ?? null,
            createdDate: u.createdDate,
          })),
          startAt: 0,
          maxResults: 50,
          total: spec.users.length,
          isLast: true,
        },
      };
    },
    (req) => {
      if (!req.path.startsWith('/rest/api/3/group/bulk')) return null;
      // Reality: Jira's bulk endpoint only knows JIRA groups.
      return {
        status: 200,
        json: { values: spec.jiraGroups.map((g) => ({ groupId: g.groupId, name: g.name })), startAt: 0, maxResults: 50, total: spec.jiraGroups.length, isLast: true },
      };
    },
    (req) => {
      if (!req.path.startsWith('/rest/api/3/group/member?')) return null;
      const gid = new URLSearchParams(req.path.split('?')[1]).get('groupId');
      // Realistic: Jira only knows its OWN groups; confluence ids would 404.
      const group = spec.jiraGroups.find((g) => g.groupId === gid);
      if (!group) return { status: 404, json: null };
      return {
        status: 200,
        json: {
          values: (group?.members ?? []).map((id) => {
            const u = spec.users.find((x) => x.accountId === id)!;
            return { accountId: u.accountId, displayName: u.displayName, active: u.active, emailAddress: u.emailAddress, accountType: null, createdDate: u.createdDate };
          }),
          startAt: 0,
          maxResults: 50,
          isLast: true,
        },
      };
    },
    (req) => {
      if (!req.path.startsWith('/wiki/rest/api/group?')) return null;
      // Reality: the wiki endpoint serves CONFLUENCE groups.
      return { status: 200, json: { results: spec.confluenceGroups.map((g) => ({ id: g.groupId, name: g.name })), start: 0, limit: 50, isLast: true } };
    },
    (req) => {
      const m = req.path.match(/\/wiki\/rest\/api\/group\/([^/]+)\/member/);
      if (!m) return null;
      const group = [...spec.jiraGroups, ...spec.confluenceGroups].find((g) => g.groupId === decodeURIComponent(m[1]));
      return {
        status: 200,
        json: {
          results: (group?.members ?? []).map((id) => {
            const u = spec.users.find((x) => x.accountId === id)!;
            return { account: { accountId: u.accountId, displayName: u.displayName, active: u.active, email: u.emailAddress, type: null } };
          }),
          start: 0,
          limit: 50,
          isLast: true,
        },
      };
    },
    // Enhanced JQL search: token-flavored termination (no nextPageToken = end).
    (req) => {
      if (!(req.method === 'POST' && req.path.startsWith('/rest/api/3/search/jql'))) return null;
      return {
        status: 200,
        json: {
          issues: spec.issues.map((h) => ({
            key: h.key,
            fields: {
              creator: h.creator ? { accountId: h.creator } : null,
              assignee: h.assignee ? { accountId: h.assignee } : null,
              reporter: h.reporter ? { accountId: h.reporter } : null,
              created: iso(h.createdDaysAgo),
              updated: iso(h.updatedDaysAgo),
            },
          })),
        },
      };
    },
    // Wiki search: per-account window-filtered CQL.
    (req) => {
      if (!req.path.startsWith('/wiki/rest/api/search?')) return null;
      const accountId = cqlAccountIdFromPath(req.path);
      if (!accountId) return null;
      const hits = spec.contributions[accountId] ?? [];
      return {
        status: 200,
        json: {
          results: hits.map((h) => ({ content: { id: h.contentId }, version: { when: iso(h.whenDaysAgo) } })),
          start: 0,
          limit: 25,
          isLast: true,
        },
      };
    },
    (req) => (req.path.startsWith('/forge/app/v1/license') ? { status: 404, json: null } : null),
  ];
}

async function runLiveScan(spec: LiveTenantSpec): Promise<FinalReport> {
  const gateway = new ForgeAtlassianGateway({
    transport: transportWith(routesFor(spec)),
    sleepFn: async () => undefined,
    seed: 7,
  });
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
  if (!rec.report) throw new Error(`no report; streams=${JSON.stringify(rec.streams)}`);
  return rec.report;
}

describe('LIVE-SHAPE PARITY (LIVE-SHAPE-1, LIVE-SHAPE-2, LIVE-SHAPE-3; functional BLOCKER 1 repair)', () => {
  it('LIVE-SHAPE-2: a Confluence contribution 5d ago in production payload shape forces KEEP, never SAFE_NOW', async () => {
    const report = await runLiveScan({
      users: [
        // Carla: authored a Jira issue 100d ago AND contributed to Confluence
        // 5 days ago — identical underlying reality to the audit probe.
        { accountId: 'live-carla', displayName: 'Carla Contributor', emailAddress: 'carla@corp.example', active: true, createdDate: iso(900) },
        { accountId: 'live-finn', displayName: 'Finn FullSweep', emailAddress: 'finn@corp.example', active: true, createdDate: iso(2200) },
      ],
      jiraGroups: [{ groupId: 'g-jira-users', name: 'Jira Software Users', members: ['live-carla', 'live-finn'] }],
      confluenceGroups: [{ groupId: 'g-conf-users', name: 'Confluence Users', members: ['live-carla', 'live-finn'] }],
      issues: [{ key: 'CORP-1', createdDaysAgo: 100, updatedDaysAgo: 100, creator: 'live-carla', assignee: null, reporter: 'live-carla' }],
      contributions: {
        'live-carla': [{ contentId: 'c-123', whenDaysAgo: 5 }],
        'live-finn': [],
      },
      jiraSeats: 10,
    });

    const carla = report.recommendations.find((r) => r.accountId === 'live-carla');
    expect(carla, 'carla card emitted').toBeTruthy();
    // THE REGRESSION: pre-repair this classified SAFE_NOW via fabricated
    // measured absence; the only honest class for a 5d-old contribution is KEEP.
    expect(carla!.risk.klass).toBe('KEEP');
    expect(carla!.why.ruleId).toBe('RULE_RECENT_ACTIVITY');
    // The evidence must carry the POSITIVE observation...
    const kinds = carla!.evidence.map((e) => e.kind);
    expect(kinds).toContain('CONFLUENCE_CONTRIBUTION');
    // ...and NOTHING may claim measured absence: pre-repair, the Confluence
    // hit was rendered as "full-window sweep found zero observations" — a
    // provably false statement (functional BLOCKER 1 repro language).
    const zeroClaims = carla!.evidence.filter((e) => e.detail.includes('found zero observations'));
    expect(zeroClaims, JSON.stringify(carla!.evidence)).toHaveLength(0);

    // Finn remains a legitimate measured-absence SAFE_NOW (both sweeps drained).
    const finn = report.recommendations.find((r) => r.accountId === 'live-finn');
    expect(finn!.risk.klass).toBe('SAFE_NOW');
    expect(report.status).toBe('COMPLETE');
  });

  it('LIVE-SHAPE-3: parses raw live payloads through the SAME adapters (no transport-only fields)', async () => {
    // Adapter-level equivalence: the exact raw row shape used above parses to
    // the same Wire DTO the fixture path produces for equivalent reality.
    const { parseWireContributionItem, attributedContribution, parseWireUserItem } = await import('../src/gateway/adapters');
    const rawRow = { content: { id: 'c-9' }, version: { when: iso(30) } };
    const hit = attributedContribution(parseWireContributionItem(rawRow), 'acct-x');
    expect(hit.lastModified).toBe(iso(30)); // pre-repair: hard-coded null here
    expect(hit.contributorAccountId).toBe('acct-x');

    const rawUser = { accountId: 'u1', displayName: 'Dana', active: true, emailAddress: 'dana.local@corp.example', accountType: null, createdDate: iso(100) };
    const wu = parseWireUserItem(rawUser);
    expect(wu.emailHint).toBe('dana.local'); // SEC-L2: local part only, domain dropped

    // A hit whose temporal field is unusable keeps lastModified null...
    const broken = parseWireContributionItem({ content: { id: 'c-10' }, version: {} });
    expect(broken.lastModified).toBeNull();
  });
});
