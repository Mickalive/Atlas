/**
 * Production composition root + resolver registration.
 *
 * SECURITY INVARIANTS:
 *  - Tenant identity is derived EXCLUSIVELY from server-resolved Forge
 *    context (TEN-1/TEN-4). Client-supplied tenant/cloud/site parameters are
 *    ignored for authorization.
 *  - This module imports ONLY the production gateway. The fixture transport
 *    is unreachable from here by construction (ADV-3, enforced statically).
 *  - Data mode is unconditionally LIVE in this entrypoint (FIX-1).
 */

import Resolver from '@forge/resolver';
import type { AtlasStorage } from './storage';
import { tenantScopedStorage } from './storage';
import { logger } from './logger';
import { ForgeAtlassianGateway } from '../gateway/forge/forgeGateway';
import { ScanService, RESOLVER_CHUNK_BUDGET_MS } from './scanService';
import type { FinalReport } from '../core/types';
import { buildDashboardViewModel, sortRecommendations } from '../core/uimodel/dashboard';
import { buildCsvExport, buildMarkdownBrief } from '../core/export/exporters';

interface ForgeInvocationContext {
  installationId?: string;
  cloudId?: string;
  accountId?: string;
  [k: string]: unknown;
}

/** Server-side tenant derivation; throws when Forge context is unusable. */
export function deriveTenantId(context: ForgeInvocationContext): string {
  const candidate =
    (typeof context.installationId === 'string' && context.installationId.length > 0 && context.installationId) ||
    (typeof context.cloudId === 'string' && context.cloudId.length > 0 && context.cloudId);
  if (!candidate) {
    throw new Error('tenant context missing: refusing to serve without server-resolved installation identity');
  }
  return candidate;
}

function buildService(context: ForgeInvocationContext): { service: ScanService; tenantId: string; storage: AtlasStorage } {
  const tenantId = deriveTenantId(context);
  const storage = tenantScopedStorage(tenantId);
  const gateway = new ForgeAtlassianGateway({
    telemetry: undefined,
    // Org-admin enrichment ships OFF (SEC-2c). Enabling requires an explicit
    // configuration change plus a security review of secret handling.
    orgEnrichment: { enabled: false, orgId: null, getApiKey: async () => null },
  });
  const service = new ScanService({ gateway, dataMode: 'LIVE', storage });
  return { service, tenantId, storage };
}

async function publicSnapshot(service: ScanService): Promise<Record<string, unknown>> {
  const rec = await service.getCurrentRecord();
  if (!rec || !rec.report) {
    return {
      running: true,
      status: rec?.status ?? 'QUEUED',
      phase: rec?.phase ?? 'queued',
      streams: {},
      vm: null,
      report: null,
      recommendations: [],
    };
  }
  const report: FinalReport = rec.report;
  return {
    running: false,
    status: report.status,
    phase: rec.phase,
    vm: buildDashboardViewModel(report),
    report,
    recommendations: sortRecommendations(report.recommendations),
  };
}

const resolver = new Resolver();

resolver.define('bootstrap', async ({ context }: { context: ForgeInvocationContext }) => {
  const { service } = buildService(context);
  await service.ensureScan();
  await service.runChunk(RESOLVER_CHUNK_BUDGET_MS);
  return publicSnapshot(service);
});

resolver.define('poll', async ({ context }: { context: ForgeInvocationContext }) => {
  const { service } = buildService(context);
  const current = await service.getCurrentRecord();
  if (current && (current.status === 'QUEUED' || current.status === 'RUNNING')) {
    await service.runChunk(RESOLVER_CHUNK_BUDGET_MS);
  }
  return publicSnapshot(service);
});

resolver.define('rescan', async ({ context }: { context: ForgeInvocationContext }) => {
  const { service } = buildService(context);
  const current = await service.getCurrentRecord();
  if (current) {
    current.status = 'QUEUED';
    current.report = null;
    current.phase = 'queued';
    // Admin-initiated reset overrides any stale lease from a previous
    // invocation (SEC-H2); the fresh chunk re-acquires its own lease.
    current.leaseUntilEpochMs = null;
    current.leaseOwnerToken = null;
  }
  await service.ensureScan();
  await service.runChunk(RESOLVER_CHUNK_BUDGET_MS);
  return publicSnapshot(service);
});

resolver.define('setRenewalDate', async ({ payload, context }: { payload: any; context: ForgeInvocationContext }) => {
  const { service } = buildService(context);
  const raw = typeof payload?.nextRenewalDate === 'string' ? payload.nextRenewalDate : '';
  const parsed = Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString() : null;
  const cfg = await service.getRenewalConfig();
  await service.setRenewalConfig({ ...cfg, nextRenewalDate: parsed });
  const snap = await publicSnapshot(service);
  if (snap.report) {
    // Re-derive renewal strip cheaply from stored config without a rescan.
    const report = snap.report as FinalReport;
    report.renewal.nextRenewalDate = parsed;
    report.renewal.daysToRenewal = parsed
      ? Math.max(0, Math.floor((Date.parse(parsed) - Date.parse(report.generatedAt)) / 86_400_000))
      : null;
    snap.vm = buildDashboardViewModel(report);
  }
  return snap;
});

resolver.define('setExceptions', async ({ payload, context }: { payload: any; context: ForgeInvocationContext }) => {
  const { service } = buildService(context);
  const ids = Array.isArray(payload?.exceptionAccountIds)
    ? (payload.exceptionAccountIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128)
    : [];
  const cfg = await service.getRenewalConfig();
  await service.setRenewalConfig({ ...cfg, exceptionAccountIds: [...new Set(ids)] });
  logger.info('exceptions updated', { count: ids.length });
  return { ok: true, count: ids.length };
});

resolver.define('buildExport', async ({ payload, context }: { payload: any; context: ForgeInvocationContext }) => {
  const { service } = buildService(context);
  const rec = await service.getCurrentRecord();
  if (!rec || !rec.report) return { format: payload?.format ?? 'markdown', content: '# No completed scan yet\n' };
  const format = payload?.format === 'csv' ? 'csv' : 'markdown';
  const content = format === 'csv' ? buildCsvExport(rec.report) : buildMarkdownBrief(rec.report);
  return { format, content };
});

export const handler = resolver.getDefinitions();

/**
 * Scheduled-trigger entrypoint: resumes interrupted scans within the async
 * runtime budget (feasibility §7). Same engine, same checkpoint state.
 */
export async function scanChunkHandler(_event: unknown, context: ForgeInvocationContext): Promise<void> {
  try {
    const { service } = buildService(context);
    const SCHEDULED_CHUNK_BUDGET_MS = 800_000;
    await service.runChunk(SCHEDULED_CHUNK_BUDGET_MS);
  } catch (err) {
    logger.error('scheduled chunk failed', { detail: err instanceof Error ? err.message : 'unknown' });
  }
}
