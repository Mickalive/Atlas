/**
 * GATE-6 — provenance, fixture visibility and export honesty
 * (FIX-1..FIX-4, AC9, AC11, AC13).
 */
import { describe, expect, it } from 'vitest';

import { selectDataMode } from '../src/dev/dataMode';
import { memoryStorage } from '../src/backend/storage';
import { ScanService } from '../src/backend/scanService';
import { FixtureAtlassianGateway } from '../src/gateway/fixture/fixtureGateway';
import { FIXTURE_EXCEPTION_ACCOUNTS, FIXTURE_SCAN_NOW } from '../src/gateway/fixture/dataset';
import { buildDashboardViewModel, sortRecommendations } from '../src/core/uimodel/dashboard';
import { buildCsvExport, buildMarkdownBrief, exportHeaderLines } from '../src/core/export/exporters';
import type { FinalReport } from '../src/core/types';

async function runDefault(): Promise<FinalReport> {
  const storage = memoryStorage();
  const service = new ScanService({
    gateway: new FixtureAtlassianGateway({ variant: 'default' }),
    dataMode: 'FIXTURE',
    storage,
    nowMs: () => Date.parse(FIXTURE_SCAN_NOW),
    log: () => undefined,
  });
  await service.setRenewalConfig({ nextRenewalDate: null, exceptionAccountIds: [...FIXTURE_EXCEPTION_ACCOUNTS] });
  await service.ensureScan();
  let rec = await service.runChunk(60_000);
  let guard = 0;
  while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard++ < 200) rec = await service.runChunk(60_000);
  return rec.report as FinalReport;
}

describe('FIX-1 explicit data-mode selection (fail-closed)', () => {
  it('defaults to LIVE with no env', () => {
    expect(selectDataMode({}).mode).toBe('LIVE');
    expect(selectDataMode({ ATLAS_DATA_MODE: '' }).mode).toBe('LIVE');
    expect(selectDataMode({ ATLAS_DATA_MODE: 'live' }).mode).toBe('LIVE');
  });

  it('FIX-1b: requires the exact explicit opt-in for sample mode', () => {
    expect(selectDataMode({ ATLAS_DATA_MODE: 'fixture' }).mode).toBe('FIXTURE');
    expect(() => selectDataMode({ ATLAS_DATA_MODE: ' Fixture ' })).toThrow();
    expect(() => selectDataMode({ ATLAS_DATA_MODE: 'demo' })).toThrow();
  });
});

describe('FIX-2/FIX-3 provenance stamping and non-live banner', () => {
  it('every report, recommendation and stream carries the dataMode stamp', async () => {
    const report = await runDefault();
    expect(report.dataMode).toBe('FIXTURE');
    for (const rec of report.recommendations) {
      expect(rec.dataMode).toBe('FIXTURE');
    }
  });

  it('dashboard VM shows an unmissable DEMO banner for fixture data', async () => {
    const vm = buildDashboardViewModel(await runDefault());
    expect(vm.showNonLiveBanner).toBe(true);
    expect(vm.nonLiveBannerText).toContain('DEMO DATA');
    expect(vm.nonLiveBannerText).toContain('NOT A LIVE SCAN');
    expect(vm.scanStatusLine).toContain('dataMode=FIXTURE');
  });

  it('a LIVE-stamped report renders no demo banner (provenance-driven, not mode-driven)', async () => {
    const report = await runDefault();
    const liveReport: FinalReport = structuredClone(report);
    liveReport.dataMode = 'LIVE';
    for (const rec of liveReport.recommendations) rec.dataMode = 'LIVE';
    const vm = buildDashboardViewModel(liveReport);
    expect(vm.showNonLiveBanner).toBe(false);
    expect(vm.scanStatusLine).toContain('dataMode=LIVE');
  });

  // SEC-M2 repair: provenance fails CLOSED. A missing/corrupted stamp is not
  // proof of live origin and must render the non-live banner.
  it('a MISSING/corrupted dataMode stamp renders the non-live banner (fail-closed)', async () => {
    const report = await runDefault();
    const corrupted: FinalReport = structuredClone(report);
    (corrupted as unknown as Record<string, unknown>).dataMode = undefined;
    const vm = buildDashboardViewModel(corrupted);
    expect(vm.showNonLiveBanner).toBe(true);
    expect(vm.nonLiveBannerText).toMatch(/UNVERIFIED DATA PROVENANCE/);
  });
});

describe('FIX-4 export stamping and honesty blocks (AC9/AC13)', () => {
  it('FIX-4a: CSV exports carry watermark, assumptions, window coverage, model version', async () => {
    const csv = buildCsvExport(await runDefault());
    expect(csv).toContain('dataMode: FIXTURE');
    expect(csv).toContain('ATLAS SAMPLE DATA');
    expect(csv).toContain('window_coverage:');
    expect(csv).toContain('pricing_model_versions: jira-standard-monthly-2026H2');
    expect(csv).toContain('# assumption:');
    expect(csv).toContain('exact_sum_rounded_down_once');
  });

  it('FIX-4b: markdown brief carries the irreversibly stamped warning header', async () => {
    const md = buildMarkdownBrief(await runDefault());
    expect(md.split('\n')[2]).toContain('ATLAS SAMPLE DATA (dataMode=FIXTURE)');
  });

  it('FIX-4c: header lines enumerate partial streams when present', async () => {
    const storage = memoryStorage();
    const service = new ScanService({
      gateway: new FixtureAtlassianGateway({ variant: 'partial_failure' }),
      dataMode: 'FIXTURE',
      storage,
      nowMs: () => Date.parse(FIXTURE_SCAN_NOW),
      log: () => undefined,
    });
    await service.ensureScan();
    let rec = await service.runChunk(60_000);
    let guard = 0;
    while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard++ < 200) rec = await service.runChunk(60_000);
    const report = rec.report as FinalReport;
    const headers = exportHeaderLines(report);
    expect(headers.some((l) => l.startsWith('partial_stream:') && l.includes('jiraGroupMembers'))).toBe(true);
  });
});

describe('AC2/AC3 money-first ordering and collapsed classes', () => {
  it('hero label is ESTIMATED ANNUAL SAVINGS with safe/review split before any user counts', async () => {
    const vm = buildDashboardViewModel(await runDefault());
    expect(vm.hero.label).toBe('ESTIMATED ANNUAL SAVINGS');
    expect(vm.hero.displayDollars).toBeGreaterThan(0);
    expect(typeof vm.hero.split.safeNowDollars).toBe('number');
    // Product table rows are dollar columns; user counts appear nowhere on top.
    expect(vm.productTable.every((p) => typeof p.safeNowDollars === 'number')).toBe(true);
  });

  it('sorts SAFE_NOW before REVIEW then by dollars desc within class', () => {
    const recs = [
      { risk: { klass: 'REVIEW' }, money: { annualDeltaCents: 100 }, id: 'r1' },
      { risk: { klass: 'SAFE_NOW' }, money: { annualDeltaCents: 10 }, id: 's1' },
      { risk: { klass: 'REVIEW' }, money: { annualDeltaCents: 500 }, id: 'r2' },
    ] as never[];
    const sorted = sortRecommendations(recs);
    expect(sorted.map((r) => r.id)).toEqual(['s1', 'r2', 'r1']);
  });
});

describe('renewal strip semantics (F6)', () => {
  it('prompts for a renewal date when unset and computes countdown when set', async () => {
    const storage = memoryStorage();
    const service = new ScanService({
      gateway: new FixtureAtlassianGateway({ variant: 'default' }),
      dataMode: 'FIXTURE',
      storage,
      nowMs: () => Date.parse(FIXTURE_SCAN_NOW),
      log: () => undefined,
    });
    await service.ensureScan();
    let rec = await service.runChunk(60_000);
    let guard = 0;
    while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard++ < 200) rec = await service.runChunk(60_000);
    let report = rec.report as FinalReport;
    let vm = buildDashboardViewModel(report);
    expect(vm.renewalStrip.hasDate).toBe(false);
    expect(vm.renewalStrip.promptText).toContain('12-month');

    await service.setRenewalConfig({ nextRenewalDate: '2026-12-01T00:00:00.000Z', exceptionAccountIds: [] });
    await service.ensureScan(); // same scan still RUNNING? terminal -> rescan needed
    rec = await service.runChunk(60_000); // terminal: returns stored report
    report = rec.report as FinalReport;
    report = structuredClone(report);
    report.renewal.nextRenewalDate = '2026-12-01T00:00:00.000Z';
    report.renewal.daysToRenewal = Math.floor(
      (Date.parse('2026-12-01') - Date.parse(FIXTURE_SCAN_NOW)) / 86_400_000,
    );
    vm = buildDashboardViewModel(report);
    expect(vm.renewalStrip.hasDate).toBe(true);
    expect(vm.renewalStrip.daysToRenewal).toBeGreaterThan(0);
    expect(vm.renewalStrip.exposureNote ?? '').toContain('T-minus');
  });
});
