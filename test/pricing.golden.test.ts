/**
 * Financial engine tests — PRODUCT_V1.md §5 / AC4 / AC5 / AC12 / FP-24 / FP-25 / FP-S4.
 */
import { describe, expect, it } from 'vitest';

import { applyMinimumSeats, computeScenarioDelta, datasetMeta, detectCrossings, displayDollarsFromCents } from '../src/core/finance/engine';
import { DATASET_STALENESS_DAYS, shippedPriceTables } from '../src/core/finance/priceTables';
import type { PriceDataset } from '../src/core/finance/priceTables';

const TODAY = '2026-08-26T00:00:00.000Z';

function jiraStandard(): PriceDataset {
  const ds = shippedPriceTables().find((t) => t.productId === 'jira' && t.status === 'SOURCED');
  if (!ds) throw new Error('sourced Jira Standard dataset missing');
  return ds;
}

describe('AC4 golden progressive-band case (FP-24, frozen)', () => {
  it('FP-24: prices 450 Jira Standard monthly seats at exactly $3,175.00/month', () => {
    const ds = jiraStandard();
    // Full-cost check via zero-removal scenario: before == after => delta 0,
    // so verify the curve directly through a 450 -> 449 comparison pair and
    // reconstruct the absolute cost from band arithmetic.
    const cost450 =
      100 * ds.bands[0].unitMonthlyCents +
      150 * ds.bands[1].unitMonthlyCents +
      200 * ds.bands[2].unitMonthlyCents;
    expect(cost450).toBe(317_500); // $3175.00 in cents

    const est451 = monthlyCostFor(ds, 451);
    expect(est451).toBe(cost450 + ds.bands[2].unitMonthlyCents);
  });

  it('computes a one-seat reduction inside the golden band as 12x unit price annually', () => {
    const est = computeScenarioDelta(jiraStandard(), { currentBillableSeats: 450, seatsRemoved: 1, todayIso: TODAY });
    expect(est).not.toBeNull();
    expect(est?.annualDeltaCents).toBe(610 * 12);
    expect(est?.pricingModelVersion).toBe('jira-standard-monthly-2026H2');
    expect(est?.datasetEffectiveDate).toBe('2026-08-26');
    expect(est?.realizationTiming).toBe('NEXT_BILLING_PERIOD'); // MQB semantics
  });
});

/** Direct band integration helper mirroring engine internals. */
function monthlyCostFor(ds: PriceDataset, seatsRaw: number): number {
  const seats = applyMinimumSeats(ds, seatsRaw);
  let total = 0;
  for (const b of ds.bands) {
    if (seats < b.fromSeats) break;
    const top = Math.min(seats, b.toSeats);
    total += (top - b.fromSeats + 1) * b.unitMonthlyCents;
    if (seats <= b.toSeats) return total;
  }
  return Number.NaN;
}

describe('AC4 boundary crossings (AC4-B, >=10 cases incl. annual tier steps)', () => {
  const ds = jiraStandard();

  const boundaryCases: Array<[number, number, string]> = [
    [101, 100, 'drops below first band edge'],
    [100, 99, 'within first band'],
    [251, 250, 'drops below second band edge'],
    [250, 249, 'within second band'],
    [500, 499, 'drops below third band edge'],
    [501, 500, 'leaves sourced range (unbounded)'],
    [150, 140, 'intra-band reduction'],
    [260, 101, 'multi-band drop'],
    [300, 299, 'third band single seat'],
    [120, 110, 'first-to-second band interior'],
    [499, 480, 'near upper sourced edge'],
    [11, 10, 'just above minimum floor'],
  ];

  it.each(boundaryCases)('%i -> %i: %s', (before, after, label) => {
    const removed = before - after;
    const est = computeScenarioDelta(ds, { currentBillableSeats: before, seatsRemoved: removed, todayIso: TODAY });
    expect(est, label).not.toBeNull();
    if (!est) return;

    const beforeBilled = Math.max(before, ds.minimumBillableSeats ?? 0);
    const afterBilled = Math.max(after, ds.minimumBillableSeats ?? 0);

    if (beforeBilled > ds.knownUpToSeats || afterBilled > ds.knownUpToSeats) {
      expect(est.bounded).toBe(false);
      expect(est.realizationTiming).toBe('QUOTE_REQUIRED');
      return;
    }

    const expectedMonthly = monthlyCostFor(ds, beforeBilled) - monthlyCostFor(ds, afterBilled);
    expect(est.annualDeltaCents).toBe(expectedMonthly * 12);
    const expectedCrossings = detectCrossings(beforeBilled, afterBilled, ds);
    expect(est.crossings.length).toBe(expectedCrossings.length);
  });

  it('flags the 101->100 band-edge drop explicitly', () => {
    const est = computeScenarioDelta(ds, { currentBillableSeats: 101, seatsRemoved: 1, todayIso: TODAY });
    expect(est?.crossings.some((c) => c.description.includes('101-250'))).toBe(true);
    // Marginal value of seat #101 is the second-band unit price.
    expect(est?.annualDeltaCents).toBe(730 * 12);
  });

  it('AC4-NB: never extrapolates beyond the sourced range', () => {
    const est = computeScenarioDelta(ds, { currentBillableSeats: 501, seatsRemoved: 1, todayIso: TODAY });
    expect(est?.bounded).toBe(false);
    expect(est?.annualDeltaCents).toBe(0);
    expect(est?.unboundedReason).toContain('known up to 500');
  });
});

describe('annual fixed-tier datasets (engine capability)', () => {
  const annualDataset: PriceDataset = {
    ...jiraStandard(),
    billingMode: 'ANNUAL_FIXED_TIERS',
    modelVersion: 'test-annual-tiers-v1',
    bands: [],
    tiers: [
      { upToSeats: 100, perSeatAnnualCents: 8_000 },
      { upToSeats: 250, perSeatAnnualCents: 7_000 },
      { upToSeats: 10_000, perSeatAnnualCents: 6_000 },
    ],
    minimumBillableSeats: null,
    knownUpToSeats: 10_000,
  };

  it('bills whole tiers and realizes savings at renewal', () => {
    const est = computeScenarioDelta(annualDataset, { currentBillableSeats: 250, seatsRemoved: 10, todayIso: TODAY });
    expect(est?.annualDeltaCents).toBe(10 * 7_000); // 10 seats x tier-2 per-seat rate
    expect(est?.realizationTiming).toBe('NEXT_RENEWAL');
  });

  it('detects annual tier-boundary steps', () => {
    const est = computeScenarioDelta(annualDataset, { currentBillableSeats: 105, seatsRemoved: 10, todayIso: TODAY });
    expect(est?.crossings.some((c) => c.description.includes('tier boundary at 100'))).toBe(true);
    // 95 seats x tier-1 price vs 105 x tier-2 price: removal INCREASES cost
    // due to upward tier crossing; delta is clamped to 0 (F-LOW 1 repair).
    expect(est?.annualDeltaCents).toBe(0);
  });
});

describe('minimum-seat floors (FP-25)', () => {
  it('does not claim savings while removal stays above/at the floor boundary correctly', () => {
    const ds = jiraStandard(); // minimum 10
    const atFloor = computeScenarioDelta(ds, { currentBillableSeats: 10, seatsRemoved: 1, todayIso: TODAY });
    // 10 -> 9 raw seats bills AS 10 (documented minimum): no savings may appear.
    expect(atFloor?.annualDeltaCents).toBe(0);
    expect(atFloor?.afterPosition).toContain('10 seats');

    const aboveFloor = computeScenarioDelta(ds, { currentBillableSeats: 12, seatsRemoved: 1, todayIso: TODAY });
    expect(aboveFloor?.annualDeltaCents).toBe(860 * 12);
  });
});

describe('rounding policy (FP-S4 / AC13)', () => {
  it('rounds savings DOWN for display, aggregates exact-sum-then-round-once', () => {
    expect(displayDollarsFromCents(30_999)).toBe(309);
    const perItem = [103_20 * 10, 555, 9_999]; // cents
    const exactTotal = perItem.reduce((a, b) => a + b, 0);
    const sumOfFloored = perItem.reduce((a, b) => a + displayDollarsFromCents(b), 0);
    const heroOnce = displayDollarsFromCents(exactTotal);
    expect(heroOnce).toBeGreaterThanOrEqual(sumOfFloored);
    expect(heroOnce - sumOfFloored).toBeLessThan(perItem.length);
  });
});

describe('AC12 dataset metadata/staleness', () => {
  it('marks datasets older than the window stale', () => {
    const meta = datasetMeta(jiraStandard(), '2027-03-01T00:00:00.000Z');
    expect(meta.stale).toBe(true);
    const fresh = datasetMeta(jiraStandard(), '2026-08-27T00:00:00.000Z');
    expect(fresh.stale).toBe(false);
  });

  it('exposes sourceUrl and effective date on every shipped dataset', () => {
    for (const ds of shippedPriceTables()) {
      expect(ds.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ds.sourceUrl.length).toBeGreaterThan(3);
      expect(ds.modelVersion).toBeTruthy();
      void DATASET_STALENESS_DAYS;
    }
  });
});
