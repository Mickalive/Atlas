/**
 * Recommendation engine.
 *
 * Emits WHAT/WHY/MONEY/RISK/EVIDENCE cards (FP-S2) and exact-cent totals
 * (FP-S3). Money is computed ONLY through the financial engine's scenario
 * deltas; multi-group redundancy is deduplicated before money math so a seat
 * is never reclaimed twice (FP-12), and per-product estimates are summed at
 * billing-identity level without cross-product double counting (FP-13).
 */

import type {
  DataMode,
  MoneyEstimate,
  ProductId,
  Recommendation,
  ScanTotals,
} from '../types';
import type { ClassificationResult, SeatHolding } from '../risk/classify';
import { computeScenarioDelta } from '../finance/engine';
import type { PriceDataset } from '../finance/priceTables';
import { shippedPriceTables } from '../finance/priceTables';

export interface RecommendationInput {
  scanId: string;
  dataMode: DataMode;
  accountId: string;
  displayName: string | null;
  accessPaths: string[];
  classification: ClassificationResult;
  /** Tenant-level billable seat baseline per product, resolved upstream. */
  billableSeatsByProduct: Partial<Record<ProductId, number>>;
  evidenceLines: Recommendation['evidence'];
  todayIso: string;
}

function datasetFor(productId: ProductId): PriceDataset | null {
  const tables = shippedPriceTables();
  // V1 sourced snapshot covers Jira Standard; other products are explicitly
  // PRICING_UNKNOWN and produce quote-required outputs downstream.
  if (productId === 'jira') {
    return tables.find((t) => t.productId === 'jira' && t.status === 'SOURCED') ?? null;
  }
  return tables.find((t) => t.productId === productId) ?? null;
}

export function buildRecommendation(input: RecommendationInput): Recommendation {
  const products = [...input.classification.reclaimableProducts].sort();

  let combined: MoneyEstimate | null = null;
  let anyUnbounded = false;
  const crossingNotes: string[] = [];

  const unboundedNotes: string[] = [];

  for (const productId of products) {
    const seatsBefore = input.billableSeatsByProduct[productId];
    const ds = datasetFor(productId);
    if (!ds || ds.status !== 'SOURCED' || seatsBefore === undefined) {
      anyUnbounded = true;
      unboundedNotes.push(`${productId}: no verified price table \u2014 portion requires a quote and is excluded from totals.`);
      continue;
    }
    const est = computeScenarioDelta(ds, {
      currentBillableSeats: seatsBefore,
      seatsRemoved: 1,
      todayIso: input.todayIso,
    });
    if (!est) {
      anyUnbounded = true;
      unboundedNotes.push(`${productId}: scenario could not be priced \u2014 excluded from totals.`);
      continue;
    }
    if (!est.bounded) {
      // Seat count leaves the sourced range: this product's portion is
      // excluded from the delta but the exclusion is surfaced.
      anyUnbounded = true;
      unboundedNotes.push(`${productId}: ${est.unboundedReason ?? 'unbounded'}`);
      continue;
    }
    crossingNotes.push(...est.crossings.map((c) => `${productId}: ${c.description}`));
    if (combined === null) {
      const firstCopy: MoneyEstimate = { ...est };
      combined = firstCopy;
    } else if (est.annualDeltaCents > 0) {
      const merged: MoneyEstimate = {
        ...combined,
        annualDeltaCents: combined.annualDeltaCents + est.annualDeltaCents,
        crossings: [...combined.crossings, ...est.crossings],
      };
      combined = merged;
    }
  }

  /**
   * Money honesty model: include only defensible (bounded, SOURCED) portions;
   * when ANY held product lacks verified pricing the estimate is flagged
   * bounded=false with an explicit reason, and totals count it as
   * quote-required while keeping the defensible portion visible.
   */
  let money: MoneyEstimate | null = null;
  if (combined !== null) {
    if (!anyUnbounded) {
      money = combined;
    } else {
      const partial: MoneyEstimate = { ...combined, bounded: false };
      partial.unboundedReason = unboundedNotes.join(' ');
      money = partial;
    }
  }

  // Honesty labeling (functional MEDIUM 7): distinguish seats backed by
  // product-specific measurements from ride-along seats on the same account.
  const productsMeasured = [...new Set(input.classification.corroboratedProducts)].sort();
  const rideAlong = products.filter((p) => !productsMeasured.includes(p));
  const measuredNote =
    products.length > 0 && rideAlong.length > 0
      ? productsMeasured.length > 0
        ? ` Activity evidence was measured on ${productsMeasured.join(' + ')}; ${rideAlong.join(' + ')} ride${rideAlong.length === 1 ? 's' : ''} along on the account-level classification without product-specific sweeps.`
        : ` No product-specific activity sweep backs these seats; classification rides on account-level evidence.`
      : '';

  return {
    id: `rec:${input.accountId}:${products.join('+') || 'noproduct'}`,
    dataMode: input.dataMode,
    accountId: input.accountId,
    displayName: input.displayName,
    products,
    productsMeasured,
    accessPaths: input.accessPaths,
    what:
      products.length > 0
        ? `Reclaim 1 licensed seat for ${input.displayName ?? input.accountId} in ${products.join(' + ')}.${measuredNote}`
        : `Access review for ${input.displayName ?? input.accountId}`,
    why: {
      ruleId: input.classification.ruleId,
      thresholdSummary: input.classification.thresholdSummary,
      detail: input.classification.detail,
    },
    money,
    risk: {
      klass: input.classification.klass,
      checks: input.classification.checks,
    },
    evidence: input.evidenceLines,
  };
}

export interface TotalsInput {
  recommendations: Recommendation[];
  deactivatedExcludedCount: number;
  protectedExcludedFromSafeNow: number;
  /**
   * KEEP/UNKNOWN counts over the FULL analysis population (functional HIGH 4).
   * Emission is capped, so recounting from emitted cards understates collapsed
   * counts; when provided these population figures are authoritative.
   */
  populationKeepCount?: number;
  populationUnknownCount?: number;
}

export function computeTotals(input: TotalsInput): ScanTotals {
  // Exact sums first; presentation rounds down ONCE at display (FP-S4).
  let safeNowAnnualCents = 0;
  let reviewPoolAnnualCents = 0;
  let quoteRequiredCount = 0;
  let keepCount = 0;
  let unknownCount = 0;

  /**
   * Pool policy (single source of truth — dashboard, markdown brief and CSV
   * TOTALS rows all render THIS result; functional MEDIUM 6): pools contain
   * only defensible exact-cent deltas (bounded estimates, or the sourced-
   * portion of partially-bounded estimates). Items with any unbounded
   * component are additionally counted as quote-required so nothing silently
   * disappears.
   */
  for (const rec of input.recommendations) {
    switch (rec.risk.klass) {
      case 'SAFE_NOW':
        if (rec.money) safeNowAnnualCents += rec.money.annualDeltaCents;
        if (!rec.money || !rec.money.bounded) quoteRequiredCount += 1;
        break;
      case 'REVIEW':
        if (rec.money) reviewPoolAnnualCents += rec.money.annualDeltaCents;
        if (!rec.money || !rec.money.bounded) quoteRequiredCount += 1;
        break;
      case 'KEEP':
        keepCount += 1;
        break;
      case 'UNKNOWN':
        unknownCount += 1;
        break;
    }
  }

  if (typeof input.populationKeepCount === 'number') keepCount = input.populationKeepCount;
  if (typeof input.populationUnknownCount === 'number') unknownCount = input.populationUnknownCount;

  return {
    safeNowAnnualCents,
    reviewPoolAnnualCents,
    keepCount,
    unknownCount,
    quoteRequiredCount,
    deactivatedExcludedCount: input.deactivatedExcludedCount,
    protectedExcludedFromSafeNow: input.protectedExcludedFromSafeNow,
  };
}
