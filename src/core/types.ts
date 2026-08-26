/**
 * Atlas canonical domain types.
 *
 * These models are the single downstream vocabulary for the entire product.
 * Everything downstream of the Atlas-owned Atlassian gateway boundary
 * (normalization -> evidence -> risk -> finance -> recommendations -> UI
 * models -> exports) speaks ONLY these types. Nothing here imports or
 * references any transport, SDK or activation-mode concept.
 */

/** Provenance stamp required on every persisted/rendered/exported artifact. */
export type DataMode = 'LIVE' | 'FIXTURE';

/** Products Atlas analyzes in V1. Coverage claims follow the feasibility map. */
export type ProductId = 'jira' | 'confluence' | 'jsm' | 'jpd';

export type PlanName = 'STANDARD' | 'PREMIUM' | 'ENTERPRISE' | 'FREE' | 'PAID' | 'UNKNOWN';

export type BillingMode = 'MONTHLY_PROGRESSIVE_BANDS' | 'ANNUAL_FIXED_TIERS' | 'UNKNOWN';

export type PricingConfidence = 'LIST_ESTIMATE' | 'ASSUMED_DEFAULTS' | 'CUSTOM_RATES' | 'UNAVAILABLE';

/**
 * Canonical risk classes (PRODUCT_CONTRACT.md). Nothing outside these four
 * may ever reach a recommendation card.
 */
export type RiskClass = 'SAFE_NOW' | 'REVIEW' | 'KEEP' | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface CanonicalUser {
  accountId: string;
  displayName: string | null;
  /** Only a sanitized domain-style hint when explicitly needed for service-account heuristics; never stored beyond that. */
  emailHint: string | null;
  /** Platform `active` flag. False means already deactivated. */
  active: boolean;
  /** ISO date the account was created, when the platform exposes it. Often null => treated as UNKNOWN age. */
  accountCreatedAt: string | null;
  accountType: 'human' | 'service_heuristic' | 'unknown';
}

export interface GroupRef {
  groupId: string;
  groupName: string;
}

export interface ApplicationRole {
  /** e.g. "jira-software", "jira-servicedesk", "jira-product-discovery" */
  roleKey: string;
  name: string | null;
  groupIds: string[];
  userCount: number | null;
  numberOfSeats: number | null;
  remainingSeats: number | null;
  hasUnlimitedSeats: boolean | null;
}

export interface ProductPlanInfo {
  applicationId: string;
  plan: PlanName;
}

export interface ApproximateSeatCount {
  total: number | null;
  /** Up-to-seven-days cache staleness disclosed by the license metrics API. */
  asOfHint: string | null;
}

// ---------------------------------------------------------------------------
// Activity evidence
// ---------------------------------------------------------------------------

export type SignalKind =
  | 'ISSUE_AUTHORSHIP'
  | 'ISSUE_ASSIGNMENT'
  | 'CONFLUENCE_CONTRIBUTION'
  | 'ORG_LAST_ACTIVE'
  /**
   * A drained, permission-clean sweep of a product's contribution surface
   * that found ZERO observations for the user across the full window.
   * This is a positive *negative* observation: absence was actually measured,
   * not merely missing. It is the only form of "absence" that can corroborate.
   */
  | 'NEGATIVE_SWEEP_JIRA'
  | 'NEGATIVE_SWEEP_CONFLUENCE';

export interface ActivitySignal {
  kind: SignalKind;
  /** Product the signal was observed in (null only for org-wide last_active). */
  productId: ProductId | null;
  /** ISO instant of the most recent observation, or null for pure negative sweeps. */
  lastObservedAt: string | null;
  /** End of the period the observation covers (usually scan time). */
  observedThrough: string;
  /** Where this came from, e.g. "jira.search.jql", "org.api.last_active". */
  source: string;
}

export interface WindowCoverage {
  windowStart: string;
  windowEnd: string;
  /** True only when the underlying acquisition streams for this evidence were fully drained and permission-clean. */
  complete: boolean;
}

export interface UserProductEvidence {
  accountId: string;
  productId: ProductId;
  signals: ActivitySignal[];
  coverage: WindowCoverage;
  /** True when a required activity input was missing/malformed (ERR-2/ERR-6). Forces UNKNOWN downstream. */
  dataUnavailableReason: string | null;
  /** Any positive (non-sweep) observation exists for this user x product. */
  hasAnyPositiveSignal: boolean;
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export interface BandCrossing {
  description: string;
}

export interface MoneyEstimate {
  /** Exact annual delta in integer US cents. Never a float. */
  annualDeltaCents: number;
  pricingConfidence: PricingConfidence;
  pricingModelVersion: string;
  datasetEffectiveDate: string;
  currency: 'USD';
  /** Human-readable position before/after, e.g. "450 seats (band 251-500)" */
  beforePosition: string;
  afterPosition: string | null;
  crossings: BandCrossing[];
  /** When the savings realize: monthly MQB => next billing period; annual => next renewal. */
  realizationTiming: 'NEXT_BILLING_PERIOD' | 'NEXT_RENEWAL' | 'QUOTE_REQUIRED';
  /**
   * False when the seat count leaves the sourced price-table range: the
   * estimate is then UNBOUNDED and must never enter aggregate totals.
   */
  bounded: boolean;
  unboundedReason?: string;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export interface DependencyCheck {
  check:
    | 'ADMIN_LIKE_GROUP_PATTERN'
    | 'SERVICE_ACCOUNT_HEURISTIC'
    | 'EXCEPTION_LIST'
    | 'RECENT_ACCOUNT_CREATION'
    | 'DEACTIVATED_ACCOUNT'
    | 'WINDOW_FULLY_COVERED'
    | 'CORROBORATION_RULE'
    | 'CONFLICTING_RECENT_SIGNAL';
  result: 'PASS' | 'FAIL' | 'NOT_EVALUABLE';
  detail: string;
}

export interface Recommendation {
  id: string;
  dataMode: DataMode;
  accountId: string;
  displayName: string | null;
  products: ProductId[];
  accessPaths: string[];
  what: string;
  why: {
    ruleId: string;
    thresholdSummary: string;
    detail: string;
  };
  money: MoneyEstimate | null;
  risk: {
    klass: RiskClass;
    checks: DependencyCheck[];
  };
  evidence: Array<{
    kind: SignalKind | 'GROUP_MEMBERSHIP' | 'PLATFORM_ACTIVE_FLAG' | 'ACCOUNT_AGE';
    source: string;
    observedAt: string | null;
    detail: string;
  }>;
}

// ---------------------------------------------------------------------------
// Scan lifecycle
// ---------------------------------------------------------------------------

export type ScanStatus = 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';

export type StreamState = 'PENDING' | 'RUNNING' | 'OK' | 'DEGRADED' | 'FAILED';

export interface StreamTelemetry {
  streamId: string;
  state: StreamState;
  reason: string | null;
  pagesFetched: number;
  itemsFetched: number;
  httpFailures: { status: number; count: number }[];
}

export interface ScanWindow {
  windowStart: string;
  windowEnd: string;
  windowDays: number;
}

export interface ScanTotals {
  /** Exact sums in cents; presentation rounds down once at display. */
  safeNowAnnualCents: number;
  reviewPoolAnnualCents: number;
  keepCount: number;
  unknownCount: number;
  quoteRequiredCount: number;
  deactivatedExcludedCount: number;
  protectedExcludedFromSafeNow: number;
}

export interface FinalReport {
  scanId: string;
  dataMode: DataMode;
  generatedAt: string;
  window: ScanWindow;
  status: 'COMPLETE' | 'PARTIAL';
  streams: StreamTelemetry[];
  productsScanned: ProductId[];
  plans: Record<string, PlanName>;
  approxSeatCounts: Partial<Record<ProductId, ApproximateSeatCount>>;
  pricing: {
    modelVersionsUsed: string[];
    datasetEffectiveDates: string[];
    assumptions: string[];
    staleDatasets: string[];
  };
  usersAnalyzed: number;
  recommendations: Recommendation[];
  totals: ScanTotals;
  renewal: {
    nextRenewalDate: string | null;
    daysToRenewal: number | null;
    exposureUntilRenewalNote: string | null;
  };
}

export interface RenewalConfig {
  nextRenewalDate: string | null;
  /** AccountIds the tenant admin explicitly protects, acknowledging responsibility. */
  exceptionAccountIds: string[];
}
