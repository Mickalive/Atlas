/**
 * Versioned price datasets.
 *
 * HARD RULES (PRODUCT_V1.md §5, API_FEASIBILITY.md §6):
 *  - Estimates only. No Atlassian API exposes customer billing. Every dataset
 *    is a labeled list-price snapshot with sourceUrl + effectiveDate.
 *  - Only band data that is actually sourced is encoded. Where the sourced
 *    range ends, `knownUpToSeats` marks the boundary and the engine refuses to
 *    extrapolate (bounded=false). Never invent bands beyond evidence.
 *  - Naive seats x flat price is forbidden anywhere; the engine always
 *    integrates the curve on both sides of the scenario.
 *
 * Golden anchor (must stay in sync with tests/pricing.golden.test.ts):
 *   Jira Standard monthly, 450 seats =
 *     ($8.60 x 100) + ($7.30 x 150) + ($6.10 x 200) = $3175.00/month
 *   Source: atlassian.com licensing/cloud progressive-band example,
 *   retrieved 2026-08-26 (PRODUCT_V1.md §5.2).
 */

export interface ProgressiveBand {
  /** Inclusive lower seat bound (1-based). */
  fromSeats: number;
  /** Inclusive upper seat bound. */
  toSeats: number;
  /** Per-seat monthly price for this segment, integer cents. */
  unitMonthlyCents: number;
}

export interface AnnualTier {
  /** Seats up to and including this value bill at perSeatAnnualCents. */
  upToSeats: number;
  perSeatAnnualCents: number;
}

export type PriceDatasetStatus = 'SOURCED' | 'PRICING_UNKNOWN';

export interface PriceDataset {
  productId: 'jira' | 'confluence' | 'jsm' | 'jpd';
  plan: 'STANDARD' | 'PREMIUM' | 'ENTERPRISE' | 'FREE' | 'UNKNOWN';
  billingMode: 'MONTHLY_PROGRESSIVE_BANDS' | 'ANNUAL_FIXED_TIERS' | 'UNKNOWN';
  status: PriceDatasetStatus;
  modelVersion: string;
  currency: 'USD';
  effectiveDate: string;
  sourceUrl: string;
  notes: string[];
  bands: ProgressiveBand[];
  tiers: AnnualTier[];
  /**
   * Published minimum billable seats for paid plans where documented.
   * Null when unknown — never guessed.
   */
  minimumBillableSeats: number | null;
  /** Highest seat count the sourced data covers. */
  knownUpToSeats: number;
}

/** Staleness threshold for visible warnings (PRODUCT_V1.md §5.1 / AC12). */
export const DATASET_STALENESS_DAYS = 180;

const SOURCED_NOTE_ESTIMATE =
  'List-price snapshot used as an ESTIMATE. Real invoices depend on negotiated discounts, taxes and plan changes.';

const JIRA_STANDARD_MONTHLY: PriceDataset = {
  productId: 'jira',
  plan: 'STANDARD',
  billingMode: 'MONTHLY_PROGRESSIVE_BANDS',
  status: 'SOURCED',
  modelVersion: 'jira-standard-monthly-2026H2',
  currency: 'USD',
  effectiveDate: '2026-08-26',
  sourceUrl: 'https://www.atlassian.com/software/jira/pricing (progressive band example cross-checked in PRODUCT_V1.md §5.2)',
  notes: [
    SOURCED_NOTE_ESTIMATE,
    'Bands verified against the published worked example: 450 seats = 8.60x100 + 7.30x150 + 6.10x200 = $3,175.00/month.',
    'Pricing beyond 500 seats is not encoded: the sourced example does not extend past that boundary.',
  ],
  bands: [
    { fromSeats: 1, toSeats: 100, unitMonthlyCents: 860 },
    { fromSeats: 101, toSeats: 250, unitMonthlyCents: 730 },
    { fromSeats: 251, toSeats: 500, unitMonthlyCents: 610 },
  ],
  tiers: [],
  // Widely documented Cloud behavior: paid plans bill a minimum of 10 users monthly.
  minimumBillableSeats: 10,
  knownUpToSeats: 500,
};

function unknownDataset(
  productId: PriceDataset['productId'],
  reason: string,
): PriceDataset {
  return {
    productId,
    plan: 'UNKNOWN',
    billingMode: 'UNKNOWN',
    status: 'PRICING_UNKNOWN',
    modelVersion: `${productId}-unverified-2026H2`,
    currency: 'USD',
    effectiveDate: '2026-08-26',
    sourceUrl: 'n/a — no currently sourced public band/tier table meeting the evidence bar',
    notes: [reason],
    bands: [],
    tiers: [],
    minimumBillableSeats: null,
    knownUpToSeats: 0,
  };
}

/**
 * Conservative shipped snapshot: ONLY the golden-anchored dataset is marked
 * SOURCED. All other product/plan combinations are explicitly PRICING_UNKNOWN
 * until a sourced table passes review (BLK-7 protection: no invented numbers).
 */
export function shippedPriceTables(): PriceDataset[] {
  return [
    JIRA_STANDARD_MONTHLY,
    unknownDataset(
      'jira',
      'Premium/Enterprise band tables were not verified against current official sources during this cycle; savings require a quote.',
    ),
    unknownDataset('confluence', 'Confluence band tables were not verified this cycle; seat enumeration is also DEGRADED without org enrichment.'),
    unknownDataset('jsm', 'JSM agent-per-tier tables were not verified this cycle.'),
    unknownDataset('jpd', 'JPD creator-seat pricing semantics are UNKNOWN per feasibility map row 13.'),
  ];
}

export interface ResolvedDataset {
  dataset: PriceDataset;
  stale: boolean;
}
