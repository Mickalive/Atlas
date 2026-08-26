/**
 * Money-first UI view models.
 *
 * Ordering is frozen by PRODUCT_V1.md §3: dollars first, always. The only
 * provenance-derived rendering here reads the `dataMode` stamp carried ON THE
 * DATA (a corrupted/stamped record renders the banner too — this is a
 * provenance check, not an activation-mode branch; static gates forbid actual
 * mode-selection identifiers inside core modules).
 */

import type { FinalReport, Recommendation } from '../types';
import { displayDollarsFromCents } from '../finance/engine';

export interface DashboardViewModel {
  dataMode: FinalReport['dataMode'];
  showNonLiveBanner: boolean;
  nonLiveBannerText: string;
  hero: {
    label: 'ESTIMATED ANNUAL SAVINGS';
    displayDollars: number;
    exactCents: number;
    split: { safeNowDollars: number; reviewPoolDollars: number };
    quoteRequiredCount: number;
    boundedNote: string | null;
  };
  scanStatusLine: string;
  isPartial: boolean;
  partialReasons: string[];
  renewalStrip: {
    hasDate: boolean;
    nextRenewalDate: string | null;
    daysToRenewal: number | null;
    exposureNote: string | null;
    promptText: string;
  };
  productTable: Array<{
    product: string;
    seatsLabel: string;
    safeNowDollars: number | null;
    reviewPoolDollars: number | null;
    bandPosition: string | null;
    boundaryCallout: boolean;
  }>;
  pricing: {
    modelVersionsUsed: string[];
    assumptions: string[];
    staleDatasets: string[];
    staleWarning: string | null;
  };
  collapsedCounts: { keep: number; unknown: number };
}

export function buildDashboardViewModel(report: FinalReport): DashboardViewModel {
  const exactSafe = report.totals.safeNowAnnualCents;
  const exactReview = report.totals.reviewPoolAnnualCents;

  const unboundedRecs = report.recommendations.filter(
    (r) => (r.risk.klass === 'SAFE_NOW' || r.risk.klass === 'REVIEW') && (!r.money || !r.money.bounded),
  ).length;

  const perProduct = new Map<string, { safe: number; review: number; recs: Recommendation[] }>();
  for (const rec of report.recommendations) {
    if (!rec.money) continue;
    for (const p of rec.products) {
      let entry = perProduct.get(p);
      if (!entry) {
        entry = { safe: 0, review: 0, recs: [] };
        perProduct.set(p, entry);
      }
      if (rec.risk.klass === 'SAFE_NOW') entry.safe += rec.money.annualDeltaCents;
      if (rec.risk.klass === 'REVIEW') entry.review += rec.money.annualDeltaCents;
      entry.recs.push(rec);
    }
  }

  const partialReasons = report.streams
    .filter((s) => s.state === 'DEGRADED' || s.state === 'FAILED')
    .map((s) => `${s.streamId}: ${s.reason ?? s.state}`);

  const staleWarning =
    report.pricing.staleDatasets.length > 0
      ? `Pricing data older than ${report.pricing.staleDatasets.join(', ')} may be stale \u2014 verify before relying on figures.`
      : null;

  return {
    dataMode: report.dataMode,
    showNonLiveBanner: report.dataMode === 'FIXTURE',
    nonLiveBannerText: 'DEMO DATA \u2014 NOT A LIVE SCAN',
    hero: {
      label: 'ESTIMATED ANNUAL SAVINGS',
      displayDollars: displayDollarsFromCents(exactSafe + exactReview),
      // Hero leads with total opportunity, split immediately below.
      exactCents: exactSafe + exactReview,
      split: {
        safeNowDollars: displayDollarsFromCents(exactSafe),
        reviewPoolDollars: displayDollarsFromCents(exactReview),
      },
      quoteRequiredCount: report.totals.quoteRequiredCount,
      boundedNote:
        unboundedRecs > 0 || report.totals.quoteRequiredCount > 0
          ? `${Math.max(unboundedRecs, report.totals.quoteRequiredCount)} recommendation(s) need a verified price table or quote and are excluded from totals until then.`
          : null,
    },
    scanStatusLine: `Scan ${report.status} \u00b7 ${report.productsScanned.join(', ') || 'no products'} \u00b7 window ${report.window.windowDays}d \u00b7 ${report.generatedAt} \u00b7 dataMode=${report.dataMode}`,
    isPartial: report.status === 'PARTIAL',
    partialReasons,
    renewalStrip: report.renewal.nextRenewalDate
      ? {
          hasDate: true,
          nextRenewalDate: report.renewal.nextRenewalDate,
          daysToRenewal: report.renewal.daysToRenewal,
          exposureNote: report.renewal.exposureUntilRenewalNote,
          promptText: '',
        }
      : {
          hasDate: false,
          nextRenewalDate: null,
          daysToRenewal: null,
          exposureNote: null,
          promptText:
            'Set your next renewal date to convert these savings into a renewal-ready action plan. Until then a forward 12-month horizon is the estimate basis.',
        },
    productTable: [...perProduct.entries()]
      .sort((a, b) => b[1].safe + b[1].review - (a[1].safe + a[1].review))
      .map(([product, v]) => {
        const sample = v.recs.find((r) => r.money);
        return {
          product,
          seatsLabel:
            report.approxSeatCounts[product as keyof FinalReport['approxSeatCounts']]?.total !== undefined &&
            report.approxSeatCounts[product as keyof FinalReport['approxSeatCounts']]?.total !== null
              ? `${String(report.approxSeatCounts[product as keyof FinalReport['approxSeatCounts']]?.total)} (approximate)`
              : 'UNKNOWN',
          safeNowDollars: v.safe > 0 ? displayDollarsFromCents(v.safe) : 0,
          reviewPoolDollars: v.review > 0 ? displayDollarsFromCents(v.review) : 0,
          bandPosition: sample?.money?.beforePosition ?? null,
          boundaryCallout: v.recs.some((r) => (r.money?.crossings.length ?? 0) > 0),
        };
      }),
    pricing: {
      modelVersionsUsed: report.pricing.modelVersionsUsed,
      assumptions: report.pricing.assumptions,
      staleDatasets: report.pricing.staleDatasets,
      staleWarning,
    },
    collapsedCounts: { keep: report.totals.keepCount, unknown: report.totals.unknownCount },
  };
}

export type RecommendationSortKey = 'risk_then_dollars';

/** SAFE_NOW before REVIEW; within class sorted by dollar value desc (frozen §3). */
export function sortRecommendations(recs: Recommendation[]): Recommendation[] {
  const order: Record<string, number> = { SAFE_NOW: 0, REVIEW: 1, KEEP: 2, UNKNOWN: 3 };
  return [...recs].sort((a, b) => {
    const ka = order[a.risk.klass];
    const kb = order[b.risk.klass];
    if (ka !== kb) return ka - kb;
    const da = a.money?.annualDeltaCents ?? 0;
    const db = b.money?.annualDeltaCents ?? 0;
    if (db !== da) return db - da;
    return a.id.localeCompare(b.id);
  });
}
