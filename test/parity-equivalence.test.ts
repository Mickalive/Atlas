/**
 * AC10 parity equivalence — the production pipeline must produce byte-identical
 * reports from two transports serving equivalent envelopes.
 *
 * Gateway A: FixtureAtlassianGateway (synthetic responses through shared adapters).
 * Gateway B: ReplayGateway — records every page/outcome from A, then re-serves
 * the recorded Wire data as a second independent transport instance.
 *
 * Any divergence between the runs would mean hidden transport-conditional logic
 * downstream; none may exist (PRODUCT_V1.md section 6 rule 2).
 */
import { describe, expect, it } from 'vitest';

import { memoryStorage } from '../src/backend/storage';
import { ScanService } from '../src/backend/scanService';
import { FixtureAtlassianGateway } from '../src/gateway/fixture/fixtureGateway';
import type {
  AtlassianGateway,
  GatewayOutcome,
  GatewayPage,
  PageCursor,
} from '../src/gateway/types';
import { FIXTURE_SCAN_NOW } from '../src/gateway/fixture/dataset';
import type { FinalReport } from '../src/core/types';

const FIXED_NOW_MS = Date.parse(FIXTURE_SCAN_NOW);

async function runWith(gateway: AtlassianGateway): Promise<FinalReport> {
  const service = new ScanService({
    gateway,
    dataMode: 'FIXTURE',
    storage: memoryStorage(),
    nowMs: () => FIXED_NOW_MS,
    log: () => undefined,
  });
  await service.ensureScan();
  let rec = await service.runChunk(60_000);
  let guard = 0;
  while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard++ < 300) rec = await service.runChunk(60_000);
  if (!rec.report) throw new Error('no report');
  return rec.report;
}

/** Deterministic replay wrapper: same interface, pre-recorded answers. */
class ReplayGateway implements AtlassianGateway {
  constructor(
    private recorded: {
      roles: GatewayOutcome<import('../src/gateway/types').WireApplicationRole[]>;
      plans: GatewayOutcome<import('../src/gateway/types').WirePlanInfo[]>;
      approx: Record<string, GatewayOutcome<import('../src/gateway/types').WireSeatCount>>;
      orgConfiguredFlag: boolean;
    },
    private pages: Record<string, GatewayPage<never>>,
  ) {}

  private page<T>(key: string): GatewayPage<T> {
    const hit = this.pages[key];
    if (!hit) {
      const sample = Object.keys(this.pages).filter((k) => k.split(':').slice(0, -1).join(':') === key.split(':').slice(0, -1).join(':')).slice(0, 6);
      throw new Error(`replay miss for '${key}'; nearby: ${sample.join(', ') || 'none'}`);
    }
    return hit as GatewayPage<T>;
  }

  listJiraApplicationRoles() {
    return Promise.resolve(this.recorded.roles);
  }
  getInstanceLicensePlans() {
    return Promise.resolve(this.recorded.plans);
  }
  getApproximateLicenseCount(productKey?: string) {
    return Promise.resolve(this.recorded.approx[productKey ?? 'total']);
  }
  listJiraUsers(cursor: PageCursor) {
    const k = `jiraUsers:${cursor.startAt ?? 0}:${cursor.cursor ?? ''}`;
    return Promise.resolve(this.page<never>(k));
  }
  listGroups(cursor: PageCursor) {
    return Promise.resolve(this.page<never>(`jiraGroups:${cursor.startAt ?? 0}`));
  }
  listGroupMembers(groupId: string, cursor: PageCursor) {
    return Promise.resolve(this.page<never>(`members:${groupId}:${cursor.startAt ?? 0}`));
  }
  listUserGroups() {
    return Promise.resolve({ ok: true, status: 200, value: [], malformed: false, attempts: 1, degradedFields: [] });
  }
  listConfluenceGroups(cursor: PageCursor) {
    return Promise.resolve(this.page<never>(`confGroups:${cursor.startAt ?? 0}`));
  }
  listConfluenceGroupMembers(groupId: string, cursor: PageCursor) {
    return Promise.resolve(this.page<never>(`confMembers:${groupId}:${cursor.startAt ?? 0}`));
  }
  searchConfluenceContributions(accountId: string) {
    return Promise.resolve(this.page<never>(`contrib:${accountId}`));
  }
  searchIssueActivity(_windowStartIso: string, cursor: PageCursor) {
    return Promise.resolve(this.page<never>(`issues:${cursor.startAt ?? 0}:${cursor.cursor ?? ''}`));
  }
  orgConfigured() {
    return this.recorded.orgConfiguredFlag;
  }
  listOrgUsers(cursor: PageCursor) {
    return Promise.resolve(this.page<never>(`org:${cursor.startAt ?? 0}:${cursor.cursor ?? ''}`));
  }
  getAppLicense(): Promise<GatewayOutcome<import('../src/gateway/types').WireAppLicense>> {
    return Promise.resolve({ ok: true, status: 200, value: null, malformed: false, attempts: 1, degradedFields: [] });
  }
}

describe('AC10 transport equivalence', () => {
  it('fixture and replay transports produce identical final reports', async () => {
    // Run 1: the fixture transport.
    const fixture = new FixtureAtlassianGateway({ variant: 'default' });

    // Pre-record pages by walking the fixture deterministically.
    const pages: Record<string, GatewayPage<never>> = {};
    const put = async <T>(key: string, p: Promise<GatewayPage<T>>) => {
      pages[key] = (await p) as GatewayPage<never>;
    };
    let cursor: PageCursor = {};
    for (;;) {
      const p = await fixture.listJiraUsers(cursor);
      await put(`jiraUsers:${cursor.startAt ?? 0}:${cursor.cursor ?? ''}`, Promise.resolve(p as GatewayPage<never>));
      if (p.meta.isLast !== false) break;
      cursor = p.meta.nextCursor ? { cursor: p.meta.nextCursor } : { startAt: (cursor.startAt ?? 0) + Math.max(1, p.meta.pageSize), pageLimit: p.meta.pageSize };
    }
    let groupCursor: PageCursor = {};
    for (;;) {
      const p = await fixture.listGroups(groupCursor);
      await put(`jiraGroups:${groupCursor.startAt ?? 0}`, Promise.resolve(p as GatewayPage<never>));
      if (p.meta.isLast !== false) break;
      groupCursor = { startAt: (groupCursor.startAt ?? 0) + Math.max(1, p.meta.pageSize), pageLimit: p.meta.pageSize };
    }
    const allGroupIds = new Set<string>();
    for (const key of Object.keys(pages)) {
      if (!key.startsWith('jiraGroups:')) continue;
      for (const g of pages[key].values as Array<{ groupId: string | null }>) {
        if (g.groupId) allGroupIds.add(g.groupId);
      }
    }
    for (const g of [...allGroupIds].sort()) {
      cursor = {};
      for (;;) {
        const p = await fixture.listGroupMembers(g, cursor);
        await put(`members:${g}:${cursor.startAt ?? 0}`, Promise.resolve(p as GatewayPage<never>));
        if (p.meta.isLast !== false) break;
        cursor = { startAt: (cursor.startAt ?? 0) + Math.max(1, p.meta.pageSize), pageLimit: p.meta.pageSize };
      }
    }
    cursor = {};
    for (;;) {
      const p = await fixture.listConfluenceGroups(cursor);
      await put(`confGroups:${cursor.startAt ?? 0}`, Promise.resolve(p as GatewayPage<never>));
      if (p.meta.isLast !== false) break;
      cursor = { startAt: (cursor.startAt ?? 0) + Math.max(1, p.meta.pageSize), pageLimit: p.meta.pageSize };
    }
    const confGroupIds = new Set<string>();
    for (const key of Object.keys(pages)) {
      if (!key.startsWith('confGroups:')) continue;
      for (const g of pages[key].values as Array<{ groupId: string | null }>) {
        if (g.groupId) confGroupIds.add(g.groupId);
      }
    }
    for (const g of [...confGroupIds].sort()) {
      cursor = {};
      for (;;) {
        const p = await fixture.listConfluenceGroupMembers(g, cursor);
        await put(`confMembers:${g}:${cursor.startAt ?? 0}`, Promise.resolve(p as GatewayPage<never>));
        if (p.meta.isLast !== false) break;
        cursor = { startAt: (cursor.startAt ?? 0) + Math.max(1, p.meta.pageSize), pageLimit: p.meta.pageSize };
      }
    }
    const userKeyPrefix = 'jiraUsers:';
    const allAccounts = new Set<string>();
    for (const key of Object.keys(pages)) {
      if (!key.startsWith(userKeyPrefix)) continue;
      for (const u of pages[key].values as Array<{ accountId: string | null }>) {
        if (u.accountId) allAccounts.add(u.accountId);
      }
    }
    const serviceWindowStart = new Date(Date.parse(FIXTURE_SCAN_NOW) - 180 * 86_400_000).toISOString();
    for (const a of [...allAccounts].sort()) {
      await put(`contrib:${a}`, fixture.searchConfluenceContributions(a, serviceWindowStart, {}) as Promise<GatewayPage<never>>);
    }
    cursor = {};
    for (;;) {
      const p = await fixture.searchIssueActivity(serviceWindowStart, cursor);
      await put(`issues:${cursor.startAt ?? 0}:${cursor.cursor ?? ''}`, Promise.resolve(p as GatewayPage<never>));
      if (p.meta.isLast !== false) break;
      cursor = p.meta.nextCursor ? { cursor: p.meta.nextCursor } : { startAt: (cursor.startAt ?? 0) + Math.max(1, p.meta.pageSize), pageLimit: p.meta.pageSize };
    }

    const roles = await fixture.listJiraApplicationRoles();
    const plans = await fixture.getInstanceLicensePlans();
    const approx: Record<string, GatewayOutcome<import('../src/gateway/types').WireSeatCount>> = {};
    for (const key of [undefined, 'jira', 'jira-servicedesk', 'jira-product-discovery']) {
      approx[key ?? 'total'] = await fixture.getApproximateLicenseCount(key);
    }

    const replay = new ReplayGateway(
      { roles, plans, approx, orgConfiguredFlag: false },
      pages,
    );

    const reportA = await runWith(new FixtureAtlassianGateway({ variant: 'default' }));
    const reportB = await runWith(replay);

    // Fully recursive, key-sorted canonical form.
    const stable = (v: unknown): string => {
      if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
      if (v !== null && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        return `{${Object.keys(obj).sort().map((k) => `${k}:${stable(obj[k])}`).join(',')}}`;
      }
      return JSON.stringify(v) ?? 'undefined';
    };
    expect(stable(reportB)).toBe(stable(reportA));
    expect(reportA.recommendations.length).toBeGreaterThan(5);
  });
});
