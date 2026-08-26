/**
 * EXPORT HYGIENE + POOL-POLICY UNIFICATION
 * (security SEC-L1 repair; functional MEDIUM 6 repair).
 *
 * SEC-L1: display names come from the scanned tenant's own directory; a
 * formula-shaped string must be neutralized before it reaches CSV cells.
 *
 * MEDIUM 6: pre-repair, CSV TOTALS rows re-summed only fully-bounded cards
 * while computeTotals includes the sourced portion of partially-bounded cards
 * — an admin exporting the brief saw half the dashboard number. Repaired:
 * exports render report.totals, the SAME single source as the hero and the
 * markdown brief.
 */
import { describe, expect, it } from 'vitest';

import { buildCsvExport, buildMarkdownBrief } from '../src/core/export/exporters';
import type { FinalReport, Recommendation } from '../src/core/types';
import { FIXTURE_SCAN_NOW } from '../src/gateway/fixture/dataset';

const NOW = Date.parse(FIXTURE_SCAN_NOW);

function recWith(partial: Partial<Recommendation>): Recommendation {
  return {
    id: 'rec:x:jira',
    dataMode: 'LIVE',
    accountId: 'acct-x',
    displayName: '=HYPERLINK("https://evil.example","win")',
    products: ['jira'],
    productsMeasured: ['jira'],
    accessPaths: ['jira<-g1'],
    what: 'Reclaim 1 licensed seat',
    why: { ruleId: 'RULE_TEST', thresholdSummary: 'test', detail: 'test' },
    money: {
      annualDeltaCents: 14_640,
      pricingConfidence: 'LIST_ESTIMATE',
      pricingModelVersion: 'v-test',
      datasetEffectiveDate: '2026-08-26',
      currency: 'USD',
      beforePosition: '10 seats (band 1-100)',
      afterPosition: '9 seats (band 1-100)',
      crossings: [],
      realizationTiming: 'NEXT_BILLING_PERIOD',
      bounded: true,
    },
    risk: { klass: 'SAFE_NOW', checks: [] },
    evidence: [{ kind: 'GROUP_MEMBERSHIP', source: 'test', observedAt: null, detail: 'seat paths' }],
    ...partial,
  };
}

function reportWith(recs: Recommendation[], totalsCentsSafe: number, totalsCentsReview = 0): FinalReport {
  return {
    scanId: 'scan-x',
    dataMode: 'LIVE',
    generatedAt: new Date(NOW).toISOString(),
    window: { windowStart: new Date(NOW - 180 * 86_400_000).toISOString(), windowEnd: new Date(NOW).toISOString(), windowDays: 180 },
    status: 'COMPLETE',
    streams: [],
    productsScanned: ['jira'],
    plans: {},
    approxSeatCounts: {},
    pricing: { modelVersionsUsed: [], datasetEffectiveDates: [], assumptions: [], staleDatasets: [] },
    usersAnalyzed: recs.length,
    recommendations: recs,
    totals: {
      safeNowAnnualCents: totalsCentsSafe,
      reviewPoolAnnualCents: totalsCentsReview,
      keepCount: 0,
      unknownCount: 0,
      quoteRequiredCount: 0,
      deactivatedExcludedCount: 0,
      protectedExcludedFromSafeNow: 0,
    },
    renewal: { nextRenewalDate: null, daysToRenewal: null, exposureUntilRenewalNote: null },
  };
}

describe('SEC-L1 repair: spreadsheet-formula injection is neutralized in CSV', () => {
  it('a formula-prefixed displayName cannot start a cell anymore', () => {
    const csv = buildCsvExport(reportWith([recWith({})], 14_640));
    const lines = csv.split('\n');
    // The raw payload must not appear at a cell start anywhere.
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/);
    const poisonedLine = lines.find((l) => l.includes('HYPERLINK'))!;
    expect(poisonedLine).toBeTruthy();
    expect(poisonedLine).toMatch(/,'=HYPERLINK|"'=HYPERLINK/); // apostrophe-neutralized (possibly quoted)
  });

  it('plus/minus/at/tab-prefixed cells are neutralized too', () => {
    const cases = ['+SUM(A1)', '-2+2', '@cmd', '\tTAB'];
    for (const name of cases) {
      const csv = buildCsvExport(reportWith([recWith({ displayName: name })], 0));
      for (const line of csv.split('\n').slice(1)) {
        if (line.length === 0 || line.startsWith('#') || line.startsWith('risk_class') || line.startsWith('TOTALS') || line.startsWith('SAFE_NOW_total') || line.startsWith('REVIEW_pool_total')) continue;
        const cells = line.split(',');
        const nameCell = cells[2];
        if (!nameCell || nameCell === '') continue;
        expect(nameCell.startsWith(name[0]), `cell for ${JSON.stringify(name)} => ${nameCell}`).toBe(false);
      }
    }
  });
});

describe('MEDIUM 6 repair: CSV/markdown/dashboard share ONE pool policy', () => {
  it('CSV TOTALS rows equal report.totals even when a card is partially bounded', () => {
    // Card carries a sourced portion (14640c) but is partially bounded =>
    // per-row dollar cell shows QUOTE_REQUIRED while the pool keeps its
    // defensible portion (documented pool policy).
    const partiallyBounded = recWith({
      money: {
        annualDeltaCents: 14_640,
        pricingConfidence: 'LIST_ESTIMATE',
        pricingModelVersion: 'v-test',
        datasetEffectiveDate: '2026-08-26',
        currency: 'USD',
        beforePosition: '10 seats',
        afterPosition: null,
        crossings: [],
        realizationTiming: 'QUOTE_REQUIRED',
        bounded: false,
        unboundedReason: 'jsm portion requires quote',
      },
    });
    const report = reportWith([partiallyBounded], 14_640);
    const csv = buildCsvExport(report);
    expect(csv).toContain('QUOTE_REQUIRED'); // row-level honesty kept
    expect(csv).toMatch(/SAFE_NOW_total,.*,146,/); // $146.40 floored once -> "146"
    const md = buildMarkdownBrief(report);
    expect(md).toContain('$146 / year');
  });

  it('markdown brief savings summary equals report.totals exactly', () => {
    const report = reportWith([recWith({})], 30_900, 41_200);
    const md = buildMarkdownBrief(report);
    expect(md).toContain('SAFE NOW pool: $309 / year');
    expect(md).toContain('Review pool: $412 / year');
  });

  it('ride-along products are labeled against measured surfaces in markdown', () => {
    const card = recWith({ products: ['jira', 'jsm'], productsMeasured: ['jira'] });
    const md = buildMarkdownBrief(reportWith([card], 14_640));
    expect(md).toContain('(measured: jira)');
  });
});
