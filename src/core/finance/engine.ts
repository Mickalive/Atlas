/**
 * Financial engine — pure scenario-delta math over versioned price tables.
 *
 * Invariants (binding):
 *  - Integer cents everywhere; no floating point money.
 *  - Savings are ALWAYS cost(before) - cost(after) integrated on the curve.
 *  - Seats below the documented minimum bill at the minimum.
 *  - Seat counts above knownUpToSeats => bounded=false; such estimates never
 *    enter aggregate totals and render as quote-required.
 *  - Monthly progressive billing is peak-seat based (MQB): mid-cycle removal
 *    realizes NEXT_BILLING_PERIOD. Annual tiers realize NEXT_RENEWAL.
 *  - Presentation rounding happens exactly once, rounding savings DOWN
 *    (FP-S4); aggregates are exact sums rounded once, never sum-of-rounded.
 */

import type { PriceDataset } from './priceTables';
import { DATASET_STALENESS_DAYS } from './priceTables';
import type { BillingMode, MoneyEstimate, PricingConfidence } from '../types';

export interface ScenarioInput {
  currentBillableSeats: number;
  seatsRemoved: number;
  /** ISO date used for staleness checks; injected for determinism. */
  todayIso: string;
  pricingConfidence?: PricingConfidence;
}

export interface DatasetMeta {
  modelVersion: string;
  effectiveDate: string;
  stale: boolean;
  currency: 'USD';
}

export function datasetMeta(dataset: PriceDataset, todayIso: string): DatasetMeta {
  const effective = Date.parse(dataset.effectiveDate);
  const today = Date.parse(todayIso);
  const staleDays = Number.isFinite(effective) && Number.isFinite(today)
    ? Math.floor((today - effective) / 86_400_000)
    : Number.NaN;
  return {
    modelVersion: dataset.modelVersion,
    effectiveDate: dataset.effectiveDate,
    stale: Number.isFinite(staleDays) ? staleDays > DATASET_STALENESS_DAYS : true,
    currency: dataset.currency,
  };
}

/** Cost of N billable seats under a progressive band table, integer cents/month. */
function monthlyProgressiveCost(bands: PriceDataset['bands'], seats: number): number | null {
  if (seats <= 0) return 0;
  let total = 0;
  for (const band of bands) {
    if (seats < band.fromSeats) break;
    const segmentTop = Math.min(seats, band.toSeats);
    total += (segmentTop - band.fromSeats + 1) * band.unitMonthlyCents;
    if (seats <= band.toSeats) return total;
  }
  return null; // beyond sourced range
}

/** Cost of N seats under fixed annual tiers, integer cents/year. */
function annualTierCost(tiers: PriceDataset['tiers'], seats: number): number | null {
  if (seats <= 0) return 0;
  for (const tier of tiers) {
    if (seats <= tier.upToSeats) return seats * tier.perSeatAnnualCents;
  }
  return null;
}

export function applyMinimumSeats(dataset: PriceDataset, seats: number): number {
  if (dataset.minimumBillableSeats === null) return seats;
  return Math.max(seats, dataset.minimumBillableSeats);
}

function describePosition(dataset: PriceDataset, seats: number): string {
  const underMinimum =
    dataset.minimumBillableSeats !== null &&
    seats > 0 &&
    seats < dataset.minimumBillableSeats;
  if (underMinimum) {
    return `${seats} seats (billed at documented minimum of ${dataset.minimumBillableSeats})`;
  }
  if (dataset.billingMode === 'MONTHLY_PROGRESSIVE_BANDS') {
    const band = dataset.bands.find((b) => seats >= b.fromSeats && seats <= b.toSeats);
    if (band) return `${seats} seats (band ${band.fromSeats}-${band.toSeats} @ $${(band.unitMonthlyCents / 100).toFixed(2)})`;
    if (seats === 0) return '0 seats';
    return `${seats} seats (beyond sourced bands)`;
  }
  if (dataset.billingMode === 'ANNUAL_FIXED_TIERS') {
    const tier = dataset.tiers.find((t) => seats <= t.upToSeats);
    if (tier) return `${seats} seats (annual tier up to ${tier.upToSeats})`;
    return `${seats} seats (beyond sourced tiers)`;
  }
  return `${seats} seats`;
}

export function detectCrossings(
  before: number,
  after: number,
  dataset: PriceDataset,
): { description: string }[] {
  const crossings: { description: string }[] = [];
  if (dataset.billingMode === 'MONTHLY_PROGRESSIVE_BANDS') {
    for (const band of dataset.bands) {
      const crossedDown = before >= band.fromSeats && after <= band.fromSeats - 1 && after < before;
      const crossedUp = after >= band.fromSeats && before <= band.fromSeats - 1 && after > before;
      if (crossedDown || crossedUp) {
        const dir = crossedDown ? 'drops below' : 'rises above';
        crossings.push({
          description: `Seat count ${dir} the ${band.fromSeats}-${band.toSeats} band boundary (@ $${(band.unitMonthlyCents / 100).toFixed(2)}/seat): ${before} -> ${after}`,
        });
      }
    }
  } else if (dataset.billingMode === 'ANNUAL_FIXED_TIERS') {
    for (const tier of dataset.tiers) {
      const boundary = tier.upToSeats;
      const down = before > boundary && after <= boundary;
      const up = after > boundary && before <= boundary;
      if ((down || up) && before !== after) {
        crossings.push({
          description: `Annual tier boundary at ${boundary} seats crossed (${before} -> ${after}); per-seat rate changes at renewal`,
        });
      }
    }
  }
  return crossings;
}

/**
 * Compute the annual savings delta for removing `seatsRemoved` seats.
 * Returns null when no usable dataset exists (PRICING_UNKNOWN).
 */
export function computeScenarioDelta(
  dataset: PriceDataset,
  input: ScenarioInput,
): MoneyEstimate | null {
  if (dataset.status === 'PRICING_UNKNOWN' || dataset.billingMode === 'UNKNOWN') return null;

  const removed = Math.max(0, Math.trunc(input.seatsRemoved));
  const beforeRaw = Math.max(0, Math.trunc(input.currentBillableSeats));
  const afterRaw = Math.max(0, beforeRaw - removed);

  // Minimums bind BOTH sides independently.
  const before = applyMinimumSeats(dataset, beforeRaw);
  const after = applyMinimumSeats(dataset, afterRaw);

  const meta = datasetMeta(dataset, input.todayIso);

  if (before === after) {
    // Removal is entirely inside a minimum floor or a no-op.
    return {
      annualDeltaCents: 0,
      pricingConfidence: input.pricingConfidence ?? 'LIST_ESTIMATE',
      pricingModelVersion: meta.modelVersion,
      datasetEffectiveDate: meta.effectiveDate,
      currency: 'USD',
      beforePosition: describePosition(dataset, before),
      afterPosition: describePosition(dataset, after),
      crossings: [],
      realizationTiming:
        dataset.billingMode === 'MONTHLY_PROGRESSIVE_BANDS' ? 'NEXT_BILLING_PERIOD' : 'NEXT_RENEWAL',
      bounded: true,
    };
  }

  let beforeCost: number | null;
  let afterCost: number | null;
  let timing: MoneyEstimate['realizationTiming'];

  if (dataset.billingMode === 'MONTHLY_PROGRESSIVE_BANDS') {
    beforeCost = monthlyProgressiveCost(dataset.bands, before);
    afterCost = monthlyProgressiveCost(dataset.bands, after);
    // MQB: monthly invoices follow the seat peak; reductions land next period.
    timing = 'NEXT_BILLING_PERIOD';
  } else {
    beforeCost = annualTierCost(dataset.tiers, before);
    afterCost = annualTierCost(dataset.tiers, after);
    timing = 'NEXT_RENEWAL';
  }

  if (beforeCost === null || afterCost === null) {
    return {
      annualDeltaCents: 0,
      pricingConfidence: 'UNAVAILABLE',
      pricingModelVersion: meta.modelVersion,
      datasetEffectiveDate: meta.effectiveDate,
      currency: 'USD',
      beforePosition: describePosition(dataset, before),
      afterPosition: null,
      crossings: [],
      realizationTiming: 'QUOTE_REQUIRED',
      bounded: false,
      unboundedReason: `Seat count leaves the sourced price range (known up to ${dataset.knownUpToSeats} seats). A quote-based figure is required; nothing is estimated.`,
    };
  }

  const monthlyToAnnual = dataset.billingMode === 'MONTHLY_PROGRESSIVE_BANDS' ? 12 : 1;
  // F-LOW 1: Clamp delta to non-negative. Crossing annual tier boundaries
  // upward can theoretically make removal cost more; the honest response is
  // zero savings, not negative savings displayed as loss.
  const deltaCents = Math.max(0, (beforeCost - afterCost) * monthlyToAnnual);

  return {
    annualDeltaCents: deltaCents,
    pricingConfidence: input.pricingConfidence ?? 'LIST_ESTIMATE',
    pricingModelVersion: meta.modelVersion,
    datasetEffectiveDate: meta.effectiveDate,
    currency: 'USD',
    beforePosition: describePosition(dataset, before),
    afterPosition: describePosition(dataset, after),
    crossings: detectCrossings(before, after, dataset),
    realizationTiming: timing,
    bounded: true,
  };
}

// ---------------------------------------------------------------------------
// Presentation rounding policy (FP-S4 / AC13)
// ---------------------------------------------------------------------------

/** Display policy: whole dollars, savings round DOWN. Exact cents stay internal. */
export function displayDollarsFromCents(cents: number): number {
  return Math.floor(cents / 100);
}
