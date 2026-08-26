/**
 * Export builders: CSV + Markdown renewal action brief (F6).
 *
 * Every export carries the full honesty block: generated-at, window coverage,
 * dataMode, pricing model version + effective date, assumptions. Sample-origin
 * data is stamped irreversibly into the artifact header (FIX-4).
 */

import type { FinalReport } from '../types';
import { displayDollarsFromCents } from '../finance/engine';
import { sortRecommendations } from '../uimodel/dashboard';

const FIXTURE_WATERMARK = 'ATLAS SAMPLE DATA (dataMode=FIXTURE) \u2014 NOT PRODUCED FROM A LIVE SCAN';

export function exportHeaderLines(report: FinalReport): string[] {
  const lines = [
    `generated_at: ${report.generatedAt}`,
    `dataMode: ${report.dataMode}`,
    report.dataMode === 'FIXTURE' ? `watermark: ${FIXTURE_WATERMARK}` : `watermark: none`,
    `scan_status: ${report.status}`,
    `window_coverage: ${report.window.windowStart} .. ${report.window.windowEnd} (${report.window.windowDays}d)`,
    `products_scanned: ${report.productsScanned.join(', ') || 'none'}`,
    `pricing_model_versions: ${report.pricing.modelVersionsUsed.join(', ') || 'none'}`,
    `pricing_effective_dates: ${report.pricing.datasetEffectiveDates.join(', ') || 'n/a'}`,
  ];
  for (const a of report.pricing.assumptions) lines.push(`assumption: ${a}`);
  for (const s of report.pricing.staleDatasets) lines.push(`stale_pricing_dataset: ${s}`);
  if (report.status === 'PARTIAL') {
    for (const st of report.streams.filter((x) => x.state !== 'OK')) {
      lines.push(`partial_stream: ${st.streamId} state=${st.state} reason=${st.reason ?? 'unspecified'}`);
    }
  }
  return lines;
}

/**
 * Spreadsheet-formula injection defense (SEC-L1): display names come from the
 * scanned tenant's own directory, so a co-tenant profile could carry a
 * formula-shaped string. Cells that a spreadsheet would interpret as formulas
 * are neutralized with a leading apostrophe.
 */
function neutralizeFormulaPrefix(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function csvEscape(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  const safe = neutralizeFormulaPrefix(s);
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function buildCsvExport(report: FinalReport): string {
  const rows: string[][] = [];
  rows.push(['risk_class', 'account_id', 'display_name', 'products', 'products_measured', 'access_paths', 'annual_savings_usd_display', 'realization_timing', 'rule_id', 'threshold', 'evidence_summary', 'data_mode']);
  for (const rec of sortRecommendations(report.recommendations)) {
    const dollars =
      rec.money && rec.money.bounded
        ? displayDollarsFromCents(rec.money.annualDeltaCents)
        : null;
    rows.push([
      rec.risk.klass,
      rec.accountId,
      rec.displayName ?? '',
      rec.products.join('|'),
      rec.productsMeasured.join('|'),
      rec.accessPaths.join('|'),
      dollars === null ? 'QUOTE_REQUIRED' : String(dollars),
      rec.money ? rec.money.realizationTiming : '',
      rec.why.ruleId,
      rec.why.thresholdSummary,
      rec.evidence.map((e) => `${e.kind}@${e.source}${e.observedAt ? `(${e.observedAt})` : ''}`).join('; '),
      rec.dataMode,
    ]);
  }
  // TOTALS rows render report.totals — the SAME pool policy as the dashboard
  // hero and the markdown brief (functional MEDIUM 6). Per-row display values
  // are individually floored; totals are exact-sum-then-round-once and are
  // authoritative (documented rounding). Pools include the sourced portion of
  // partially-bounded cards per computeTotals.
  rows.push([]);
  rows.push(['TOTALS', '', '', '', '', '', '', '', '', '', '', report.dataMode]);
  rows.push([
    'SAFE_NOW_total',
    '', '', '', '', '',
    String(displayDollarsFromCents(report.totals.safeNowAnnualCents)),
    'exact_sum_rounded_down_once',
    '', '', '', report.dataMode,
  ]);
  rows.push([
    'REVIEW_pool_total',
    '', '', '', '', '',
    String(displayDollarsFromCents(report.totals.reviewPoolAnnualCents)),
    'exact_sum_rounded_down_once',
    '', '', '', report.dataMode,
  ]);

  const lines = exportHeaderLines(report).map((l) => `# ${l}`);
  lines.push('');
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\n') + '\n';
}

export function buildMarkdownBrief(report: FinalReport): string {
  const out: string[] = [];
  out.push('# Atlas renewal action brief');
  out.push('');
  if (report.dataMode === 'FIXTURE') {
    out.push(`> **${FIXTURE_WATERMARK}**`);
    out.push('');
  }
  for (const l of exportHeaderLines(report)) out.push(`- ${l}`);
  out.push('');
  out.push('## Savings summary');
  out.push('');
  out.push(`- SAFE NOW pool: $${displayDollarsFromCents(report.totals.safeNowAnnualCents)} / year`);
  out.push(`- Review pool: $${displayDollarsFromCents(report.totals.reviewPoolAnnualCents)} / year`);
  if (report.totals.quoteRequiredCount > 0) {
    out.push(`- Quote-required items excluded from totals: ${report.totals.quoteRequiredCount}`);
  }
  out.push(`- Rounding policy: exact-cent sums rounded down once for display; per-item figures are individually floored.`);
  out.push('');
  out.push('## Actions');
  out.push('');
  out.push('| Risk | Account | Products | Annual savings | Owner placeholder | Rule | Evidence |');
  out.push('|---|---|---|---|---|---|---|');
  for (const rec of sortRecommendations(report.recommendations)) {
    if (rec.risk.klass !== 'SAFE_NOW' && rec.risk.klass !== 'REVIEW') continue;
    const money =
      rec.money && rec.money.bounded ? `$${displayDollarsFromCents(rec.money.annualDeltaCents)}` : 'QUOTE';
    // Ride-along labeling (functional MEDIUM 7): show which listed products
    // carry measured evidence vs riding on the account-level classification.
    const rideAlong = rec.products.filter((p) => !rec.productsMeasured.includes(p));
    const productsLabel =
      rideAlong.length > 0 && rec.productsMeasured.length > 0
        ? `${rec.products.join('+')} (measured: ${rec.productsMeasured.join('+')})`
        : rec.products.join('+');
    const accountLabel = rec.displayName ?? rec.accountId;
    out.push(
      `| ${rec.risk.klass} | ${accountLabel} | ${productsLabel} | ${money} | ______ | ${rec.why.ruleId}: ${rec.why.thresholdSummary} | ${rec.evidence.length} observation(s), re-derivable in-app |`,
    );
  }
  out.push('');
  if (report.renewal.nextRenewalDate) {
    out.push(`## Renewal plan (${report.renewal.nextRenewalDate}, T-${report.renewal.daysToRenewal ?? '?'}d)`);
  } else {
    out.push('## Renewal plan (date not set)');
  }
  if (report.renewal.exposureUntilRenewalNote) out.push(`- ${report.renewal.exposureUntilRenewalNote}`);
  return out.join('\n') + '\n';
}
