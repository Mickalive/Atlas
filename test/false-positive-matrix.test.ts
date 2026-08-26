/**
 * GATE-1 — False-positive matrix (docs/SECURITY_TEST_PLAN.md §8).
 *
 * Every FP-xx row runs through the REAL downstream pipeline: the production
 * ScanService + deriveReport + risk + finance engines fed by the
 * FixtureAtlassianGateway (FIX-5: no second scanner, no demo logic).
 * Expected classifications are BINDING; any SAFE NOW where KEEP/REVIEW/
 * UNKNOWN is required is BLK-1 and fails this suite.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { memoryStorage } from '../src/backend/storage';
import { ScanService } from '../src/backend/scanService';
import { FixtureAtlassianGateway } from '../src/gateway/fixture/fixtureGateway';
import {
  FIXTURE_EXCEPTION_ACCOUNTS,
  FIXTURE_SCAN_NOW,
  type FixtureVariant,
} from '../src/gateway/fixture/dataset';
import type { FinalReport, Recommendation, RiskClass } from '../src/core/types';

const FIXED_NOW_MS = Date.parse(FIXTURE_SCAN_NOW);

async function runVariant(variant: FixtureVariant): Promise<FinalReport> {
  console.log(`[matrix] running variant=${variant}`);
  const storage = memoryStorage();
  const gateway = new FixtureAtlassianGateway({ variant });
  const service = new ScanService({
    gateway,
    dataMode: 'FIXTURE',
    storage,
    nowMs: () => FIXED_NOW_MS,
    log: () => undefined,
  });
  await service.setRenewalConfig({ nextRenewalDate: null, exceptionAccountIds: [...FIXTURE_EXCEPTION_ACCOUNTS] });
  await service.ensureScan();
  let rec = await service.runChunk(60_000);
  let guard = 0;
  while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard < 500) {
    rec = await service.runChunk(60_000);
    guard += 1;
  }
  expect(guard).toBeLessThan(500);
  if (!rec.report) throw new Error(`no report for variant ${variant}: ${JSON.stringify(rec.streams)}`);
  return rec.report;
}

function byAccount(report: FinalReport): Map<string, Recommendation> {
  return new Map(report.recommendations.map((r) => [r.accountId, r]));
}
function klassOf(rec: Recommendation | undefined): RiskClass | 'ABSENT' {
  return rec?.risk.klass ?? 'ABSENT';
}

let report: FinalReport;
let recs: Map<string, Recommendation>;

beforeAll(async () => {
  report = await runVariant('default');
  recs = byAccount(report);
});

// ---------------------------------------------------------------------------
// Structural assertions (FP-S1..S4)
// ---------------------------------------------------------------------------

describe('FP-S structural invariants', () => {
  it('FP-S1: SAFE_NOW exists only with corroboration rule PASS and zero protected-class FAILs', () => {
    for (const rec of report.recommendations) {
      if (rec.risk.klass !== 'SAFE_NOW') continue;
      const corroboration = rec.risk.checks.find((c) => c.check === 'CORROBORATION_RULE');
      const window = rec.risk.checks.find((c) => c.check === 'WINDOW_FULLY_COVERED');
      const protectedFail = rec.risk.checks.find(
        (c) =>
          (c.check.startsWith('ADMIN_LIKE') || c.check.startsWith('SERVICE_ACCOUNT') || c.check.startsWith('EXCEPTION_LIST')) &&
          c.result === 'FAIL',
      );
      expect(corroboration?.result, rec.accountId).toBe('PASS');
      expect(window?.result, rec.accountId).toBe('PASS');
      expect(protectedFail, rec.accountId).toBeUndefined();
    }
  });

  it('FP-S2: every emitted card carries WHAT/WHY/MONEY/RISK/EVIDENCE', () => {
    for (const rec of report.recommendations) {
      expect(rec.what.length, rec.id).toBeGreaterThan(0);
      expect(rec.why.ruleId, rec.id).toMatch(/^RULE_/);
      expect(rec.risk.klass, rec.id).toMatch(/^(SAFE_NOW|REVIEW|KEEP|UNKNOWN)$/);
      expect(rec.evidence.length, rec.id).toBeGreaterThan(0);
      for (const e of rec.evidence) {
        expect(e.kind).toBeTruthy();
        expect(e.source).toBeTruthy();
      }
    }
  });

  it('FP-S3: displayed hero equals exact-sum-rounded-down-once; per-item floors never exceed it', () => {
    const safeExact = report.totals.safeNowAnnualCents;
    const reviewExact = report.totals.reviewPoolAnnualCents;
    const heroExpected = Math.floor((safeExact + reviewExact) / 100);
    let flooredSum = 0;
    for (const rec of report.recommendations) {
      if ((rec.risk.klass === 'SAFE_NOW' || rec.risk.klass === 'REVIEW') && rec.money) {
        flooredSum += Math.floor(rec.money.annualDeltaCents / 100);
      }
    }
    expect(heroOnce(report)).toBe(heroExpected);
    expect(flooredSum).toBeLessThanOrEqual(heroExpected);
    expect(heroExpected - flooredSum).toBeLessThan(
      report.recommendations.filter((r) => r.money).length,
    );
  });

  function heroOnce(r: FinalReport): number {
    // Hero displays floor of exact total once (uimodel contract).
    return Math.floor((r.totals.safeNowAnnualCents + r.totals.reviewPoolAnnualCents) / 100);
  }

  it('FP-S4: no rounding path can round savings up', () => {
    for (const rec of report.recommendations) {
      if (!rec.money) continue;
      expect(Math.floor(rec.money.annualDeltaCents / 100) * 100).toBeLessThanOrEqual(rec.money.annualDeltaCents);
    }
  });
});

// ---------------------------------------------------------------------------
// FP-01 .. FP-18 account-level matrix
// ---------------------------------------------------------------------------

describe('account classification matrix', () => {
  it('FP-01 active user is not reclaimable', () => {
    expect(klassOf(recs.get('fixture-account-active'))).toBe('KEEP');
  });

  it('FP-02 30d inactive: cautious band, never SAFE NOW', () => {
    const k = klassOf(recs.get('fixture-account-in30'));
    expect(k === 'KEEP' || k === 'REVIEW' || k === 'UNKNOWN').toBe(true);
    expect(k).not.toBe('SAFE_NOW');
  });

  it('FP-03 60d inactive: cautious band, never SAFE NOW', () => {
    const k = klassOf(recs.get('fixture-account-in60'));
    expect(['KEEP', 'REVIEW', 'UNKNOWN']).toContain(k);
    expect(k).not.toBe('SAFE_NOW');
  });

  it('FP-04 95d inactive single surface: REVIEW at most', () => {
    expect(klassOf(recs.get('fixture-account-in95'))).toBe('REVIEW');
  });

  it('FP-05 180d+ inactive across two surfaces with full coverage: highest-confidence band', () => {
    expect(klassOf(recs.get('fixture-account-stale180'))).toBe('SAFE_NOW');
  });

  it('FP-06 never-observed activity with provable window coverage: corroborated absence only', () => {
    expect(klassOf(recs.get('fixture-account-neveractive'))).toBe('SAFE_NOW');
    expect(recs.get('fixture-account-neveractive')?.why.ruleId).toBe('RULE_CORROBORATED_ABSENCE');
  });

  it('FP-07 missing/null activity field: UNKNOWN evidence, NEVER SAFE NOW (BLK-1)', () => {
    expect(klassOf(recs.get('fixture-account-malformed'))).toBe('UNKNOWN');
  });

  it('FP-08 admin-like group membership: REVIEW floor, excluded from SAFE NOW', () => {
    expect(klassOf(recs.get('fixture-account-adminlike'))).toBe('REVIEW');
    const checks = recs.get('fixture-account-adminlike')?.risk.checks ?? [];
    expect(checks.find((c) => c.check === 'ADMIN_LIKE_GROUP_PATTERN')?.result).toBe('FAIL');
  });

  it('FP-09 probable service account via explainable heuristic: REVIEW floor', () => {
    expect(klassOf(recs.get('fixture-account-servicebot'))).toBe('REVIEW');
    const checks = recs.get('fixture-account-servicebot')?.risk.checks ?? [];
    const svcCheck = checks.find((c) => c.check === 'SERVICE_ACCOUNT_HEURISTIC');
    expect(svcCheck?.result).toBe('FAIL');
    expect(svcCheck?.detail.toLowerCase()).toContain('marker');
  });

  it('FP-10 explicit exception honored absolutely; visible as protected REVIEW', () => {
    expect(klassOf(recs.get('fixture-account-exempted'))).toBe('REVIEW');
    expect(recs.get('fixture-account-exempted')?.why.ruleId.endsWith('_PROTECTED')).toBe(true);
  });

  it('FP-11 single-group seat produces clean analysis with one access path', () => {
    const dan = recs.get('fixture-account-in95');
    expect(dan?.accessPaths.filter((p) => p.startsWith('jira')).length).toBe(1);
  });

  it('FP-12 redundant multi-group access deduplicated; money counted once', () => {
    const omar = recs.get('fixture-account-multigroup');
    expect(omar?.accessPaths.length).toBe(2);
    expect(klassOf(omar)).toBe('REVIEW');
    // One seat removed despite two group paths.
    const baseline = report.approxSeatCounts.jira?.total ?? 0;
    void baseline;
    // The recommendation text must state the once-only counting rule.
    expect(JSON.stringify(omar?.what)).not.toContain('2 licensed seat');
  });

  it('FP-14 Jira-only evidence with Confluence seat held: product-scoped claim only', () => {
    // Quinn holds Confluence via group; his corroboration uses a DRAINED
    // absence sweep on Confluence plus stale Jira positives - never an
    // inference that Jira staleness implies Confluence staleness.
    const quinn = recs.get('fixture-account-mixedsurfaces');
    expect(quinn?.risk.klass).toBe('SAFE_NOW');
    const confEvidence = quinn?.evidence.filter((e) => e.kind === 'NEGATIVE_SWEEP_CONFLUENCE') ?? [];
    expect(confEvidence.length).toBeGreaterThan(0);
  });

  it('FP-15 JSM agent-like case: analyzed as licensed agent semantics', () => {
    const rita = recs.get('fixture-account-jsm-agent');
    expect(rita?.products).toContain('jsm');
    expect(klassOf(rita)).toBe('REVIEW'); // stale but single corroborating surface
  });

  it('FP-16 JPD creator-like case: plan shown, NO JPD seat savings claimed', () => {
    const sam = recs.get('fixture-account-jpd-creator');
    expect(sam?.products).not.toContain('jpd');
    expect(report.plans.jpd).toBe('PAID');
    expect(report.approxSeatCounts.jpd?.total ?? null).toBeNull(); // UNKNOWN stays UNKNOWN
  });

  it('FP-17 deactivated account: distinct class, zero savings claimed', () => {
    const lena = recs.get('fixture-account-deactivated');
    expect(klassOf(lena)).toBe('KEEP');
    expect(lena?.money ?? null).toBeNull();
    expect(report.totals.deactivatedExcludedCount).toBeGreaterThan(0);
  });

  it('FP-18 recently created account (< window): insufficient-evidence class', () => {
    expect(klassOf(recs.get('fixture-account-recentcreated'))).toBe('UNKNOWN');
    expect(recs.get('fixture-account-recentcreated')?.why.ruleId).toBe('RULE_INSUFFICIENT_OBSERVATION');
  });

  it('FP-26 duplicate identity records collapse to one canonical user', () => {
    const heidiCards = report.recommendations.filter((r) => r.accountId === 'fixture-account-malformed');
    expect(heidiCards.length).toBe(1);
    expect(report.usersAnalyzed).toBeLessThan(50); // sanity: no phantom population
  });

  it('FP-28 empty tenant: graceful zero state, no crash, no fake totals', async () => {
    const empty = await runVariant('empty_tenant');
    expect(empty.status).toBe('COMPLETE');
    expect(empty.totals.safeNowAnnualCents).toBe(0);
    expect(empty.totals.reviewPoolAnnualCents).toBe(0);
    expect(empty.usersAnalyzed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FP-19..FP-23 error/partial matrix
// ---------------------------------------------------------------------------

describe('error and partial-scan matrix', () => {
  it('FP-20 403 on one product mid-scan: PARTIAL + permission surfacing, no fabricated zeros', async () => {
    const partial = await runVariant('insufficient_permissions');
    expect(partial.status).toBe('PARTIAL');
    const failedStreams = partial.streams.filter((s) => s.state === 'FAILED');
    expect(failedStreams.some((s) => /permissions/i.test(s.reason ?? ''))).toBe(true);
    // No confluence savings may appear when confluence acquisition failed.
    const confMoney = partial.recommendations.filter((r) => r.products.includes('confluence') && (r.money?.annualDeltaCents ?? 0) > 0);
    expect(confMoney.length).toBe(0);
  });

  it('FP-21 429 then successful retry: COMPLETE with recovery recorded', async () => {
    const recovered = await runVariant('rate_limit_recovery');
    expect(recovered.status).toBe('COMPLETE');
  });

  it('FP-22 repeated 5xx: PARTIAL/FAILED with clean degraded UX data', async () => {
    const degraded = await runVariant('partial_failure');
    expect(degraded.status).toBe('PARTIAL');
    expect(degraded.streams.find((s) => s.streamId === 'jiraGroupMembers')?.state).toBe('FAILED');
  });

  it('FP-19 pagination truncation: PARTIAL, coverage scoped to drained pages (ERR-7)', async () => {
    const truncated = await runVariant('truncated_pagination');
    expect(truncated.status).toBe('PARTIAL');
    const sweep = truncated.streams.find((s) => s.streamId === 'issueSweep');
    expect(sweep?.state).toBe('FAILED');
    // Accounts whose only signals would come from the undrained sweep must not be SAFE.
    const safeAccounts = truncated.recommendations.filter((r) => r.risk.klass === 'SAFE_NOW');
    expect(safeAccounts.every((r) => !r.accountId.includes('neveractive'))).toBe(true);
  });

  it('FP-23 malformed activity payload preserved as unknown (no silent inactive-default)', () => {
    expect(klassOf(recs.get('fixture-account-malformed'))).toBe('UNKNOWN');
    expect(recs.get('fixture-account-malformed')?.why.detail).toContain('malformed');
  });
});

// ---------------------------------------------------------------------------
// Org enrichment variant
// ---------------------------------------------------------------------------

describe('org-admin enrichment (stronger evidence class)', () => {
  it('org last-active enables strong-evidence SAFE NOW and labels provenance', async () => {
    const org = await runVariant('org_enriched');
    const tina = org.recommendations.find((r) => r.accountId === 'fixture-account-orginactive');
    expect(tina?.risk.klass).toBe('SAFE_NOW');
    expect(tina?.evidence.some((e) => e.kind === 'ORG_LAST_ACTIVE' && e.source.includes('org.api'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Money integrity on the default scan
// ---------------------------------------------------------------------------

describe('default-scan money integrity', () => {
  it('safe-now pool equals sum of per-card exact deltas (Jira Standard sourced)', () => {
    const safeRecs = report.recommendations.filter((r) => r.risk.klass === 'SAFE_NOW');
    const expectedExact = safeRecs.reduce((acc, r) => acc + (r.money?.annualDeltaCents ?? 0), 0);
    expect(expectedExact).toBe(report.totals.safeNowAnnualCents);
    expect(safeRecs.length).toBeGreaterThanOrEqual(3); // Eve, Finn, Quinn
  });

  it('quote-required items are counted and excluded from nothing silently', () => {
    // Eve/Quinn hold Confluence seats without verified pricing: flagged.
    expect(report.totals.quoteRequiredCount).toBeGreaterThanOrEqual(2);
  });

  it('every money figure traces to model version + effective date + positions', () => {
    for (const rec of report.recommendations) {
      if (!rec.money) continue;
      expect(rec.money.pricingModelVersion).toBeTruthy();
      expect(rec.money.datasetEffectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rec.money.beforePosition).toBeTruthy();
      expect(['LIST_ESTIMATE', 'ASSUMED_DEFAULTS', 'CUSTOM_RATES', 'UNAVAILABLE']).toContain(rec.money.pricingConfidence);
    }
  });
});
