/**
 * Development CLI: run the FULL production pipeline over the fixture
 * transport and print the resulting report.
 *
 * This is not a demo scanner — it is the same ScanService + deriveReport used
 * in production, pointed at FixtureAtlassianGateway. Every log line from this
 * harness carries the [FIXTURE] prefix so output can never be mistaken for a
 * live scan.
 */

import { memoryStorage } from '../backend/storage';
import { ScanService } from '../backend/scanService';
import { FixtureAtlassianGateway } from '../gateway/fixture/fixtureGateway';
import { FIXTURE_EXCEPTION_ACCOUNTS, type FixtureVariant } from '../gateway/fixture/dataset';
import { buildDashboardViewModel } from '../core/uimodel/dashboard';
import { buildMarkdownBrief } from '../core/export/exporters';
import { selectDataMode } from './dataMode';

async function main(): Promise<void> {
  const mode = selectDataMode(process.env);
  if (mode.mode !== 'FIXTURE') {
    console.log('[DEV] Live mode selected but no Forge context exists outside Forge; nothing to do here.');
    return;
  }
  const variant = (process.env.ATLAS_FIXTURE_VARIANT ?? 'default') as FixtureVariant;
  console.log(`[FIXTURE] running parity pipeline variant=${variant}`);
  const storage = memoryStorage();
  const gateway = new FixtureAtlassianGateway({ variant });
  const service = new ScanService({
    gateway,
    dataMode: 'FIXTURE',
    storage,
    log: (line) => console.log(`[FIXTURE] ${line}`),
  });

  await service.ensureScan();
  // Pre-seed the explicit exception list (admin-managed config).
  await service.setRenewalConfig({ nextRenewalDate: null, exceptionAccountIds: [...FIXTURE_EXCEPTION_ACCOUNTS] });

  let rec = await service.runChunk(60_000);
  let guard = 0;
  while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard < 1000) {
    rec = await service.runChunk(60_000);
    guard += 1;
  }

  if (!rec.report) {
    console.error('[FIXTURE] scan produced no report', rec.streams);
    process.exit(1);
  }
  const vm = buildDashboardViewModel(rec.report);
  console.log('[FIXTURE] hero:', vm.hero.displayDollars, 'safe:', vm.hero.split.safeNowDollars, 'review:', vm.hero.split.reviewPoolDollars);
  console.log('[FIXTURE] status:', vm.scanStatusLine);
  if (vm.isPartial) console.log('[FIXTURE] partial reasons:', vm.partialReasons.join(' | '));
  console.log(buildMarkdownBrief(rec.report));
}

await main();
