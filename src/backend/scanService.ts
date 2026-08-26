/**
 * Checkpointed scan orchestration (API_FEASIBILITY.md §7).
 *
 * A full-environment scan cannot fit inside one invocation, so work advances
 * in budget-bounded chunks and persists ONLY compact cursors plus sharded
 * derived rows (never raw payloads).
 *
 * State machine: QUEUED -> RUNNING -> COMPLETE | PARTIAL | FAILED.
 * Per-stream completeness travels with the result so partial scans stay
 * visibly partial (parity rules 8-9, BLK-4).
 *
 * No activation-mode concept lives here: the composition root supplies an
 * AtlassianGateway plus a DataMode stamp and the service treats them alike.
 */

import type {
  AtlassianGateway,
  PageCursor,
  PageMeta,
  WireApplicationRole,
  WireIssueActivityHit,
  WireOrgUser,
  WireUser,
} from '../gateway/types';
import type { DataMode, FinalReport, ProductId, RenewalConfig, StreamState } from '../core/types';
import type { WireContributionHit } from '../gateway/types';
import { deriveReport, OBSERVATION_WINDOW_DAYS, type AcquisitionSnapshot, type StreamAcquisition } from '../core/pipeline/derive';
import type { AtlasStorage } from './storage';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface ScanBudget {
  expired(): boolean;
  msLeft(): number;
}

export function createBudget(totalMs: number, startMs: number, nowMs: () => number): ScanBudget {
  return {
    expired: () => nowMs() - startMs >= totalMs,
    msLeft: () => Math.max(0, totalMs - (nowMs() - startMs)),
  };
}

/** Resolver invocations have a 25s hard stop; stay safely under it. */
export const RESOLVER_CHUNK_BUDGET_MS = 17_000;
/** Scheduled-trigger functions may run up to 900s; stay conservative. */
export const SCHEDULED_CHUNK_BUDGET_MS = 800_000;

/** Bound on per-account Confluence contribution queries (deterministic order). */
export const CONFLUENCE_QUERY_CAP = 2000;

// ---------------------------------------------------------------------------
// Sharded accumulation lists (KVS values <=240KiB; shards stay well under)
// ---------------------------------------------------------------------------

const SHARD_TARGET_ITEMS = 500;

class ShardedList<T> {
  constructor(
    private storage: AtlasStorage,
    private name: string,
  ) {}

  async appendAll(items: T[]): Promise<void> {
    const countRec = await this.storage.getJSON<{ n: number }>(this.name, 'count');
    let n = countRec?.n ?? 0;
    let shard = Math.floor(n / SHARD_TARGET_ITEMS);
    let bucket = (await this.storage.getJSON<T[]>(this.name, String(shard))) ?? [];
    for (const item of items) {
      bucket.push(item);
      if (bucket.length >= SHARD_TARGET_ITEMS) {
        await this.storage.putJSON(this.name, bucket, String(shard));
        shard += 1;
        bucket = [];
      }
      n += 1;
    }
    if (bucket.length > 0) await this.storage.putJSON(this.name, bucket, String(shard));
    await this.storage.putJSON(this.name, { n }, 'count');
  }

  async readAll(): Promise<T[]> {
    const countRec = await this.storage.getJSON<{ n: number }>(this.name, 'count');
    const n = countRec?.n ?? 0;
    const shards = Math.ceil(n / SHARD_TARGET_ITEMS);
    const out: T[] = [];
    for (let s = 0; s < shards; s += 1) {
      const bucket = (await this.storage.getJSON<T[]>(this.name, String(s))) ?? [];
      out.push(...bucket);
    }
    return out;
  }

  async clear(): Promise<void> {
    const countRec = await this.storage.getJSON<{ n: number }>(this.name, 'count');
    const shards = Math.ceil((countRec?.n ?? 0) / SHARD_TARGET_ITEMS);
    await this.storage.putJSON(this.name, { n: 0 }, 'count');
    for (let s = 0; s < shards; s += 1) {
      await this.storage.deleteKey(this.name, String(s));
    }
  }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

type Phase =
  | 'queued'
  | 'meta'
  | 'jiraUsers'
  | 'jiraGroups'
  | 'jiraGroupMembers'
  | 'confluenceGroups'
  | 'confluenceMembers'
  | 'issueSweep'
  | 'contributionQueries'
  | 'orgUsers'
  | 'derive';

interface StreamProgress {
  state: StreamState;
  reason: string | null;
  itemsFetched: number;
  pagesFetched: number;
  /**
   * Fingerprint of the previous page's first item — loop protection for
   * responders that ignore offset probes (functional HIGH 5): an unverifiable
   * pagination continuation must degrade the stream, never spin or silently
   * report COMPLETE over a repeated window.
   */
  lastPageFingerprint: string | null;
}

interface MembershipRow {
  groupId: string;
  accountId: string;
}

interface GroupNameRow {
  productId: 'jira' | 'confluence';
  groupId: string;
  groupName: string;
}

export interface ScanRecord {
  scanId: string;
  dataMode: DataMode;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
  /** Anchor instant: window and all evidence timestamps derive from it so resumed chunks agree. */
  createdAtIso: string;
  updatedAtIso: string;
  phase: Phase;
  cursor: PageCursor;
  pendingJiraGroupIds: string[];
  pendingConfluenceGroupIds: string[];
  pendingContributionAccountIds: string[] | null;
  streams: Record<string, StreamProgress>;
  report: FinalReport | null;
  /**
   * Best-effort concurrency lease (SEC-H2): a chunk advances the shared
   * persisted record only while it holds the lease. Without CAS-backed KVS
   * this narrows — but cannot fully eliminate — interleaving windows; see
   * docs/RELEASE_STATUS.md residual-risk notes.
   */
  leaseUntilEpochMs: number | null;
  leaseOwnerToken: string | null;
}

export const STREAM_IDS = [
  'meta',
  'jiraUsers',
  'jiraGroups',
  'jiraGroupMembers',
  'confluenceGroups',
  'confluenceMembers',
  'issueSweep',
  'contributionQueries',
  'orgUsers',
] as const;

function freshRecord(scanId: string, dataMode: DataMode, nowIso: string): ScanRecord {
  const streams: Record<string, StreamProgress> = {};
  for (const id of STREAM_IDS) streams[id] = { state: 'PENDING', reason: null, itemsFetched: 0, pagesFetched: 0, lastPageFingerprint: null };
  return {
    scanId,
    dataMode,
    status: 'QUEUED',
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    phase: 'queued',
    cursor: {},
    pendingJiraGroupIds: [],
    pendingConfluenceGroupIds: [],
    pendingContributionAccountIds: null,
    streams,
    report: null,
    leaseUntilEpochMs: null,
    leaseOwnerToken: null,
  };
}

const SCAN_ENTITY = 'scan';
const CURRENT_SCAN_ID = 'current';
const CONFIG_ENTITY = 'config-renewal';
const ACQ_USERS = 'acq-users';
const ACQ_JIRA_MEMBER_ROWS = 'acq-jira-members';
const ACQ_CONF_MEMBER_ROWS = 'acq-conf-members';
const ACQ_GROUP_NAMES = 'acq-group-names';
const ACQ_ISSUE_HITS = 'acq-issue-hits';
const ACQ_CONTRIBS = 'acq-contribs';
const ACQ_ORG_USERS = 'acq-org-users';

function nextPageCursor(current: PageCursor, meta: PageMeta): PageCursor {
  if (meta.nextCursor) return { cursor: meta.nextCursor };
  if (meta.nextHref) return { cursor: meta.nextHref };
  if (typeof meta.startAt === 'number' && meta.pageSize > 0 && meta.isLast === false) {
    return { startAt: (current.startAt ?? 0) + meta.pageSize, pageLimit: meta.pageSize };
  }
  if (meta.isLast === null && meta.pageSize > 0) {
    // Unknown continuation: allow ONE offset probe forward. Loop protection
    // lives in drainVerdict's repeat-fingerprint check — if the responder
    // ignored the probe the stream degrades instead of spinning.
    return { startAt: (current.startAt ?? 0) + meta.pageSize, pageLimit: meta.pageSize };
  }
  return {};
}

function nextPhaseAfter(streamId: string): Phase {
  switch (streamId) {
    case 'meta':
      return 'jiraUsers';
    case 'jiraUsers':
      return 'jiraGroups';
    case 'jiraGroups':
      return 'jiraGroupMembers';
    case 'jiraGroupMembers':
      return 'confluenceGroups';
    case 'confluenceGroups':
      return 'confluenceMembers';
    case 'confluenceMembers':
      return 'issueSweep';
    case 'issueSweep':
      return 'contributionQueries';
    case 'contributionQueries':
      return 'orgUsers';
    default:
      return 'derive';
  }
}

function extractStatus(err: unknown): number | null {
  if (err !== null && typeof err === 'object') {
    const e = err as { statusCode?: number; status?: number };
    if (typeof e.statusCode === 'number') return e.statusCode;
    if (typeof e.status === 'number') return e.status;
  }
  return null;
}

/**
 * Drain verdicts for one fetched page (functional HIGH 5):
 *  - 'more':     the responder explicitly says a continuation exists, OR a
 *                forward probe can be constructed for an unverifiable state.
 *  - 'drained':  termination is EVIDENCED (explicit last flag, empty page,
 *                or short page against the requested size).
 *  - 'undrained': continuation could NOT be verified. The stream degrades and
 *                downstream evidence is forced UNKNOWN — an unverifiable
 *                continuation must never present as COMPLETE.
 *
 * Pure, so the shared advanceOnePage AND the multi-group member loops apply
 * identical semantics. Fixture responders always set explicit flags and are
 * unaffected; production responders omitting every pagination signal hit the
 * strict unknown path: unknown continuation defaults to INCOMPLETE, never to
 * complete.
 */
type DrainVerdict = 'drained' | 'more' | 'undrained';

export const UNDRAINED_REPEAT_REASON =
  'pagination continuation unverifiable: responder repeats the same page; coverage may be incomplete';
export const UNDRAINED_NO_PROBE_REASON =
  'pagination continuation unverifiable: responder provided no usable continuation fields; coverage may be incomplete';

function firstItemKey(values: unknown[]): string {
  return values.length > 0 ? JSON.stringify(values[0]) : '';
}

function drainVerdict(
  meta: PageMeta,
  values: unknown[],
  requestedLimit: number,
  previousFingerprint: string | null,
): { verdict: DrainVerdict; fingerprint: string | null; undrainedReason: string | null } {
  if (meta.isLast === false) {
    return { verdict: 'more', fingerprint: null, undrainedReason: null };
  }
  if (meta.isLast === true) {
    return { verdict: 'drained', fingerprint: null, undrainedReason: null };
  }
  // Continuation state unknown: the responder omitted every pagination signal.
  if (values.length === 0) {
    // Nothing at this position: definitive end under offset semantics.
    return { verdict: 'drained', fingerprint: null, undrainedReason: null };
  }
  if (requestedLimit > 0 && values.length < requestedLimit) {
    // Short page against the requested size: responder exhausted its set.
    return { verdict: 'drained', fingerprint: null, undrainedReason: null };
  }
  // Full page without continuation info: probe forward once more. A repeated
  // first-item fingerprint proves the responder ignored the probe.
  const fp = `item:${firstItemKey(values)}`;
  if (previousFingerprint !== null && previousFingerprint === fp) {
    return { verdict: 'undrained', fingerprint: null, undrainedReason: UNDRAINED_REPEAT_REASON };
  }
  return { verdict: 'more', fingerprint: fp, undrainedReason: null };
}

/**
 * Apply drainVerdict to one fetched page for `streamId`, updating counters and
 * the persisted stream progress. Call BEFORE advancing rec.cursor; the verdict
 * is a property of the response plus the request we just made. On 'undrained'
 * the stream reason is set and callers must degrade the stream (never OK).
 */
function applyPageOutcome<T>(
  rec: ScanRecord,
  streamId: string,
  page: { values: T[]; meta: PageMeta },
  requestedLimit: number,
  sentOffset: boolean,
): DrainVerdict {
  const sp = rec.streams[streamId];
  sp.pagesFetched += 1;
  sp.itemsFetched += page.values.length;
  const previousFingerprint = sp.lastPageFingerprint;
  const v = drainVerdict(page.meta, page.values as unknown[], requestedLimit, previousFingerprint);
  if (v.verdict === 'undrained') {
    sp.reason = v.undrainedReason;
    sp.lastPageFingerprint = null;
    return 'undrained';
  }
  const continuationConstructible =
    Boolean(page.meta.nextCursor) ||
    Boolean(page.meta.nextHref) ||
    typeof page.meta.startAt === 'number' ||
    sentOffset;
  if (v.verdict === 'more' && !continuationConstructible && page.meta.isLast !== false) {
    // Wanted to probe but no continuation of any kind is constructible
    // (cursor-based protocol that returned neither token nor href).
    sp.reason = UNDRAINED_NO_PROBE_REASON;
    sp.lastPageFingerprint = null;
    return 'undrained';
  }
  sp.lastPageFingerprint = v.fingerprint;
  return v.verdict;
}

/**
 * Advance one paginated stream by exactly one page per call so any budget
 * stays bounded. Returns 'drained' when finished with evidence, 'more' while a
 * (verified or probe-able) continuation exists, 'undrained' when the responder
 * leaves termination unverifiable.
 */
async function advanceOnePage<T>(
  rec: ScanRecord,
  streamId: string,
  fetchPage: (cursor: PageCursor) => Promise<{ values: T[]; meta: PageMeta }>,
  sinkItems: T[],
): Promise<DrainVerdict> {
  const requestedLimit = rec.cursor.pageLimit ?? 50;
  const sentOffset = typeof rec.cursor.startAt === 'number';
  const page = await fetchPage(rec.cursor);
  sinkItems.push(...page.values);
  const verdict = applyPageOutcome(rec, streamId, page, requestedLimit, sentOffset);
  rec.cursor = nextPageCursor(rec.cursor, page.meta);
  return verdict;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ScanServiceDeps {
  gateway: AtlassianGateway;
  dataMode: DataMode;
  storage: AtlasStorage;
  nowMs?: () => number;
  log?: (line: string) => void;
}

export class ScanService {
  private nowMs: () => number;
  private log: (line: string) => void;
  /** Identity of THIS service instance for lease ownership (SEC-H2). */
  private readonly leaseToken: string;

  constructor(private deps: ScanServiceDeps) {
    this.nowMs = deps.nowMs ?? Date.now;
    this.log = deps.log ?? (() => undefined);
    this.leaseToken = `ln-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }

  private iso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  async getRenewalConfig(): Promise<RenewalConfig> {
    const stored = await this.deps.storage.getJSON<RenewalConfig>(CONFIG_ENTITY, 'renewal');
    return stored ?? { nextRenewalDate: null, exceptionAccountIds: [] };
  }

  async setRenewalConfig(config: RenewalConfig): Promise<void> {
    await this.deps.storage.putJSON(CONFIG_ENTITY, config, 'renewal');
  }

  async getCurrentRecord(): Promise<ScanRecord | null> {
    return this.deps.storage.getJSON<ScanRecord>(SCAN_ENTITY, CURRENT_SCAN_ID);
  }

  async ensureScan(): Promise<ScanRecord> {
    const existing = await this.getCurrentRecord();
    if (existing && (existing.status === 'QUEUED' || existing.status === 'RUNNING')) return existing;
    const rec = freshRecord(`scan-${this.iso()}`, this.deps.dataMode, this.iso());
    for (const list of [
      new ShardedList<WireUser>(this.deps.storage, ACQ_USERS),
      new ShardedList<MembershipRow>(this.deps.storage, ACQ_JIRA_MEMBER_ROWS),
      new ShardedList<MembershipRow>(this.deps.storage, ACQ_CONF_MEMBER_ROWS),
      new ShardedList<GroupNameRow>(this.deps.storage, ACQ_GROUP_NAMES),
      new ShardedList<WireIssueActivityHit>(this.deps.storage, ACQ_ISSUE_HITS),
      new ShardedList<WireContributionHit>(this.deps.storage, ACQ_CONTRIBS),
      new ShardedList<WireOrgUser>(this.deps.storage, ACQ_ORG_USERS),
    ]) {
      await list.clear();
    }
    await this.deps.storage.putJSON(SCAN_ENTITY, rec, CURRENT_SCAN_ID);
    this.log(`scan queued id=${rec.scanId} mode=${rec.dataMode}`);
    return rec;
  }

  /**
   * Advance the scan by up to budgetMs. Resumable/idempotent across
   * invocations via the persisted phase+cursor checkpoint.
   *
   * Concurrency lease (SEC-H2): only one invocation may advance a record at a
   * time. The lease is acquired server-side before any stream advances,
   * renewed on every checkpoint, and cleared at terminal states; expired
   * leases are taken over so a crashed invocation cannot wedge a scan
   * forever. Forge KVS consistency semantics under concurrent put/get are
   * UNKNOWN (audit §6.4), so this is best-effort serialization — it removes
   * the systematic double-append window rather than proving mutual exclusion.
   */
  async runChunk(budgetMs: number): Promise<ScanRecord> {
    let rec: ScanRecord = (await this.getCurrentRecord()) ?? (await this.ensureScan());
    if (rec.status === 'COMPLETE' || rec.status === 'PARTIAL' || rec.status === 'FAILED') return rec;

    const now = this.nowMs();
    if (
      rec.leaseUntilEpochMs !== null &&
      rec.leaseUntilEpochMs > now &&
      rec.leaseOwnerToken !== this.leaseToken
    ) {
      this.log(
        `chunk skipped: scan ${rec.scanId} leased by another invocation until ${new Date(rec.leaseUntilEpochMs).toISOString()}`,
      );
      return rec;
    }

    const leaseTtlMs = Math.min(Math.max(budgetMs * 2, 60_000), 1_800_000);
    const renewLease = (): void => {
      rec.leaseOwnerToken = this.leaseToken;
      rec.leaseUntilEpochMs = this.nowMs() + leaseTtlMs;
    };
    const releaseLease = (): void => {
      rec.leaseUntilEpochMs = null;
      rec.leaseOwnerToken = null;
    };

    rec.status = 'RUNNING';
    renewLease();
    const budget = createBudget(budgetMs, now, this.nowMs);

    try {
      while (!budget.expired()) {
        renewLease();
        rec.updatedAtIso = this.iso();
        let stepAdvancedPhaseOrWork = false;
        switch (rec.phase) {
          case 'queued':
            rec.phase = 'meta';
            stepAdvancedPhaseOrWork = true;
            break;
          case 'meta':
            rec = await this.stepMeta(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'jiraUsers':
            rec = await this.stepUserPages(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'jiraGroups':
            rec = await this.stepJiraGroups(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'jiraGroupMembers':
            rec = await this.stepJiraGroupMembers(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'confluenceGroups':
            rec = await this.stepConfluenceGroups(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'confluenceMembers':
            rec = await this.stepConfluenceMembers(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'issueSweep':
            rec = await this.stepIssueSweep(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'contributionQueries':
            rec = await this.stepContributionQueries(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'orgUsers':
            rec = await this.stepOrgUsers(rec);
            stepAdvancedPhaseOrWork = true;
            break;
          case 'derive':
            rec = await this.stepDerive(rec);
            stepAdvancedPhaseOrWork = true;
            break;
        }
        if (rec.status === 'COMPLETE' || rec.status === 'PARTIAL' || rec.status === 'FAILED') {
          // Terminal state persisted below, then leave.
          break;
        }
        if (!stepAdvancedPhaseOrWork) {
          break; // defensive: never spin without progress
        }
        // Persist checkpoint after every step (cursors + counters only).
        await this.deps.storage.putJSON(SCAN_ENTITY, rec, CURRENT_SCAN_ID);
      }
    } catch (err) {
      rec.status = 'FAILED';
      rec.updatedAtIso = this.iso();
      const detail = err instanceof Error ? err.message : 'unknown error';
      this.log(`scan failed id=${rec.scanId} reason=${detail}`);
    }
    if (rec.status === 'COMPLETE' || rec.status === 'PARTIAL' || rec.status === 'FAILED') {
      releaseLease();
    }
    await this.deps.storage.putJSON(SCAN_ENTITY, rec, CURRENT_SCAN_ID);
    return rec;
  }

  private markStream(rec: ScanRecord, id: string, state: StreamState, reason: string | null = null): void {
    rec.streams[id] = rec.streams[id] ?? { state: 'PENDING', reason: null, itemsFetched: 0, pagesFetched: 0 };
    rec.streams[id].state = state;
    if (reason !== null) rec.streams[id].reason = reason;
  }

  private failStreamFromError(rec: ScanRecord, id: string, err: unknown, label: string): void {
    const status = extractStatus(err);
    const reason =
      status === 401 || status === 403
        ? `${label}: insufficient permissions (HTTP ${status}); missing capability recorded`
        : status === 429
          ? `${label}: rate-limit retries exhausted`
          : `${label}: upstream error (HTTP ${status ?? 'unknown'})`;
    this.markStream(rec, id, 'FAILED', reason);
    this.log(`stream degraded ${id} status=${status}`);
  }

  /** Degrade-and-continue wrapper for one-page steps (ERR-3). */
  private async guardedStep(
    rec: ScanRecord,
    streamId: string,
    body: () => Promise<DrainVerdict>,
  ): Promise<ScanRecord> {
    this.markStream(rec, streamId, rec.streams[streamId]?.state === 'PENDING' ? 'RUNNING' : rec.streams[streamId].state);
    try {
      const outcome = await body();
      if (outcome === 'drained') {
        this.markStream(rec, streamId, rec.streams[streamId].reason ? 'FAILED' : 'OK', rec.streams[streamId].reason);
        rec.cursor = {};
        rec.phase = nextPhaseAfter(streamId);
      } else if (outcome === 'undrained') {
        // Unverifiable pagination continuation: keep the acquired prefix but
        // refuse COMPLETE semantics (functional HIGH 5).
        this.markStream(rec, streamId, 'DEGRADED', rec.streams[streamId].reason);
        rec.cursor = {};
        rec.phase = nextPhaseAfter(streamId);
      }
    } catch (err) {
      this.failStreamFromError(rec, streamId, err, streamId);
      rec.streams[streamId].reason = rec.streams[streamId].reason ?? `${streamId}: failed`;
      rec.cursor = {};
      rec.phase = nextPhaseAfter(streamId);
    }
    return rec;
  }

  // --- steps ---------------------------------------------------------------

  private async stepMeta(rec: ScanRecord): Promise<ScanRecord> {
    try {
      const rolesOut = await this.deps.gateway.listJiraApplicationRoles();
      if (!rolesOut.ok || !rolesOut.value) {
        throw Object.assign(new Error('applicationrole unavailable'), { statusCode: rolesOut.status });
      }
      this.markStream(rec, 'meta', 'OK');
    } catch (err) {
      this.failStreamFromError(rec, 'meta', err, 'applicationrole');
    }
    rec.phase = 'jiraUsers';
    return rec;
  }

  private async stepUserPages(rec: ScanRecord): Promise<ScanRecord> {
    const sink = new ShardedList<WireUser>(this.deps.storage, ACQ_USERS);
    const batch: WireUser[] = [];
    return this.guardedStep(rec, 'jiraUsers', async () =>
      advanceOnePage(rec, 'jiraUsers', (c) => this.deps.gateway.listJiraUsers(c), batch).then(async (outcome) => {
        if (batch.length > 0) await sink.appendAll(batch);
        return outcome;
      }),
    );
  }

  private async stepJiraGroups(rec: ScanRecord): Promise<ScanRecord> {
    const namesSink = new ShardedList<GroupNameRow>(this.deps.storage, ACQ_GROUP_NAMES);
    return this.guardedStep(rec, 'jiraGroups', async () => {
      const requestedLimit = rec.cursor.pageLimit ?? 50;
      const sentOffset = typeof rec.cursor.startAt === 'number';
      const page = await this.deps.gateway.listGroups(rec.cursor);
      for (const g of page.values) {
        if (g.groupId) {
          rec.pendingJiraGroupIds.push(g.groupId);
          await namesSink.appendAll([{ productId: 'jira', groupId: g.groupId, groupName: g.groupName ?? g.groupId }]);
        }
      }
      const verdict = applyPageOutcome(rec, 'jiraGroups', page, requestedLimit, sentOffset);
      rec.cursor = nextPageCursor(rec.cursor, page.meta);
      return verdict;
    });
  }

  private async stepJiraGroupMembers(rec: ScanRecord): Promise<ScanRecord> {
    const membersSink = new ShardedList<MembershipRow>(this.deps.storage, ACQ_JIRA_MEMBER_ROWS);
    this.markStream(rec, 'jiraGroupMembers', 'RUNNING');

    // Drain one page of the current group; multi-page groups resume via cursor.
    const groupId = rec.pendingJiraGroupIds[0];
    if (groupId === undefined) {
      this.markStream(rec, 'jiraGroupMembers', rec.streams.jiraGroupMembers.reason ? 'FAILED' : 'OK', rec.streams.jiraGroupMembers.reason);
      rec.phase = 'confluenceGroups';
      return rec;
    }
    try {
      const requestedLimit = rec.cursor.pageLimit ?? 50;
      const sentOffset = typeof rec.cursor.startAt === 'number';
      const page = await this.deps.gateway.listGroupMembers(groupId, rec.cursor);
      await membersSink.appendAll(page.values.filter((u) => u.accountId).map((u) => ({ groupId, accountId: u.accountId as string })));
      const verdict = applyPageOutcome(rec, 'jiraGroupMembers', page, requestedLimit, sentOffset);
      const next = nextPageCursor(rec.cursor, page.meta);
      if (verdict === 'more' && (next.cursor !== undefined || next.startAt !== undefined)) {
        rec.cursor = next;
        return rec; // same group resumes next step with the persisted cursor
      }
      if (verdict === 'undrained') {
        // Unverifiable continuation inside this group: keep prefix, degrade.
        this.markStream(rec, 'jiraGroupMembers', 'DEGRADED', rec.streams.jiraGroupMembers.reason);
      }
      rec.pendingJiraGroupIds.shift();
      rec.cursor = {};
    } catch (err) {
      this.failStreamFromError(rec, 'jiraGroupMembers', err, 'group/member');
      rec.pendingJiraGroupIds.shift();
      rec.cursor = {};
      // Continue with remaining groups unless permissions are globally missing.
      const status = extractStatus(err);
      if (status === 403 || status === 401) {
        rec.pendingJiraGroupIds = [];
        this.markStream(rec, 'jiraGroupMembers', 'FAILED', rec.streams.jiraGroupMembers.reason);
        rec.phase = 'confluenceGroups';
        return rec;
      }
    }
    if (rec.pendingJiraGroupIds.length === 0) {
      this.markStream(rec, 'jiraGroupMembers', rec.streams.jiraGroupMembers.reason ? 'FAILED' : 'OK', rec.streams.jiraGroupMembers.reason);
      rec.phase = 'confluenceGroups';
    }
    return rec;
  }

  private async stepConfluenceGroups(rec: ScanRecord): Promise<ScanRecord> {
    const namesSink = new ShardedList<GroupNameRow>(this.deps.storage, ACQ_GROUP_NAMES);
    return this.guardedStep(rec, 'confluenceGroups', async () => {
      const requestedLimit = rec.cursor.pageLimit ?? 50;
      const sentOffset = typeof rec.cursor.startAt === 'number';
      const page = await this.deps.gateway.listConfluenceGroups(rec.cursor);
      for (const g of page.values) {
        if (g.groupId) {
          rec.pendingConfluenceGroupIds.push(g.groupId);
          await namesSink.appendAll([{ productId: 'confluence', groupId: g.groupId, groupName: g.groupName ?? g.groupId }]);
        }
      }
      const verdict = applyPageOutcome(rec, 'confluenceGroups', page, requestedLimit, sentOffset);
      rec.cursor = nextPageCursor(rec.cursor, page.meta);
      return verdict;
    });
  }

  private async stepConfluenceMembers(rec: ScanRecord): Promise<ScanRecord> {
    const membersSink = new ShardedList<MembershipRow>(this.deps.storage, ACQ_CONF_MEMBER_ROWS);
    this.markStream(rec, 'confluenceMembers', 'RUNNING');
    const groupId = rec.pendingConfluenceGroupIds.shift();
    if (groupId === undefined) {
      const upstreamPermFailure =
        rec.streams.confluenceGroups.state === 'FAILED' && /permissions/i.test(rec.streams.confluenceGroups.reason ?? '');
      if (upstreamPermFailure && rec.streams.confluenceMembers.state === 'PENDING') {
        this.markStream(rec, 'confluenceMembers', 'FAILED', 'confluence group member: skipped due to missing Confluence permissions');
      }
      this.markStream(rec, 'confluenceMembers', rec.streams.confluenceMembers.reason ? 'FAILED' : 'OK', rec.streams.confluenceMembers.reason);
      rec.phase = 'issueSweep';
      return rec;
    }
    try {
      const requestedLimit = rec.cursor.pageLimit ?? 50;
      const sentOffset = typeof rec.cursor.startAt === 'number';
      const page = await this.deps.gateway.listConfluenceGroupMembers(groupId, rec.cursor);
      await membersSink.appendAll(page.values.filter((u) => u.accountId).map((u) => ({ groupId, accountId: u.accountId as string })));
      const verdict = applyPageOutcome(rec, 'confluenceMembers', page, requestedLimit, sentOffset);
      const next = nextPageCursor(rec.cursor, page.meta);
      if (verdict === 'more' && (next.cursor !== undefined || next.startAt !== undefined)) {
        rec.cursor = next;
        rec.pendingConfluenceGroupIds.unshift(groupId); // continue same group next step
        return rec;
      }
      if (verdict === 'undrained') {
        this.markStream(rec, 'confluenceMembers', 'DEGRADED', rec.streams.confluenceMembers.reason);
      }
      rec.cursor = {};
    } catch (err) {
      this.failStreamFromError(rec, 'confluenceMembers', err, 'confluence group member');
      rec.cursor = {};
    }
    if (rec.pendingConfluenceGroupIds.length === 0) {
      this.markStream(rec, 'confluenceMembers', rec.streams.confluenceMembers.reason ? 'FAILED' : 'OK', rec.streams.confluenceMembers.reason);
      rec.phase = 'issueSweep';
    }
    return rec;
  }

  private async stepIssueSweep(rec: ScanRecord): Promise<ScanRecord> {
    const sink = new ShardedList<WireIssueActivityHit>(this.deps.storage, ACQ_ISSUE_HITS);
    const batch: WireIssueActivityHit[] = [];
    return this.guardedStep(rec, 'issueSweep', async () =>
      advanceOnePage(rec, 'issueSweep', (c) => this.deps.gateway.searchIssueActivity(windowStartFor(rec, this.nowMs), c), batch).then(
        async (outcome) => {
          if (batch.length > 0) await sink.appendAll(batch);
          return outcome;
        },
      ),
    );
  }

  private async stepContributionQueries(rec: ScanRecord): Promise<ScanRecord> {
    this.markStream(rec, 'contributionQueries', 'RUNNING');
    if (rec.pendingContributionAccountIds === null) {
      const users = await new ShardedList<WireUser>(this.deps.storage, ACQ_USERS).readAll();
      const ids = [...new Set(users.map((u) => u.accountId).filter((x): x is string => x !== null))].sort();
      const confBlocked =
        rec.streams.confluenceGroups.state === 'FAILED' || rec.streams.confluenceMembers.state === 'FAILED';
      // No Confluence membership data => no candidate set can be derived; skip queries.
      if (confBlocked) rec.pendingContributionAccountIds = [];
      else rec.pendingContributionAccountIds = ids.slice(0, CONFLUENCE_QUERY_CAP);
    }
    const batch = rec.pendingContributionAccountIds.splice(0, 50);
    const sink = new ShardedList<WireContributionHit>(this.deps.storage, ACQ_CONTRIBS);
    let hardFailure: unknown = null;
    for (const accountId of batch) {
      try {
        const page = await this.deps.gateway.searchConfluenceContributions(accountId, windowStartFor(rec, this.nowMs), {});
        if (page.values.length > 0) await sink.appendAll(page.values);
        else await sink.appendAll([{ contentId: null, lastModified: null, contributorAccountId: accountId, creatorAccountId: null }]);
        rec.streams.contributionQueries.itemsFetched += page.values.length;
      } catch (err) {
        hardFailure = err; // permission/rate failures degrade the whole stream once (ERR-3)
        break;
      }
    }
    if (hardFailure !== null) {
      this.failStreamFromError(rec, 'contributionQueries', hardFailure, 'confluence search');
      rec.pendingContributionAccountIds = [];
    }
    if (rec.pendingContributionAccountIds.length === 0) {
      const sp = rec.streams.contributionQueries;
      this.markStream(rec, 'contributionQueries', sp.reason ? 'FAILED' : 'OK', sp.reason);
      rec.phase = this.deps.gateway.orgConfigured() ? 'orgUsers' : 'derive';
    }
    return rec;
  }

  private async stepOrgUsers(rec: ScanRecord): Promise<ScanRecord> {
    const sink = new ShardedList<WireOrgUser>(this.deps.storage, ACQ_ORG_USERS);
    const batch: WireOrgUser[] = [];
    return this.guardedStep(rec, 'orgUsers', async () =>
      advanceOnePage(rec, 'orgUsers', (c) => this.deps.gateway.listOrgUsers(c), batch).then(async (outcome) => {
        if (batch.length > 0) await sink.appendAll(batch);
        return outcome;
      }),
    );
  }

  private async stepDerive(rec: ScanRecord): Promise<ScanRecord> {
    const [users, jiraMemberRows, confMemberRows, groupNames, issueHits, contribs, orgUsers] = await Promise.all([
      new ShardedList<WireUser>(this.deps.storage, ACQ_USERS).readAll(),
      new ShardedList<MembershipRow>(this.deps.storage, ACQ_JIRA_MEMBER_ROWS).readAll(),
      new ShardedList<MembershipRow>(this.deps.storage, ACQ_CONF_MEMBER_ROWS).readAll(),
      new ShardedList<GroupNameRow>(this.deps.storage, ACQ_GROUP_NAMES).readAll(),
      new ShardedList<WireIssueActivityHit>(this.deps.storage, ACQ_ISSUE_HITS).readAll(),
      new ShardedList<WireContributionHit>(this.deps.storage, ACQ_CONTRIBS).readAll(),
      new ShardedList<WireOrgUser>(this.deps.storage, ACQ_ORG_USERS).readAll(),
    ]);

    const [rolesOut, plansOut] = await Promise.all([
      this.deps.gateway.listJiraApplicationRoles().catch(() => null),
      this.deps.gateway.getInstanceLicensePlans().catch(() => null),
    ]);
    const approxByProduct: Partial<Record<ProductId, number | null>> = {};
    for (const productKey of ['jira', 'jira-servicedesk', 'jira-product-discovery'] as const) {
      const out = await this.deps.gateway.getApproximateLicenseCount(productKey).catch(() => null);
      if (out && out.ok && out.value) {
        const productId: ProductId | null =
          productKey === 'jira' ? 'jira' : productKey === 'jira-servicedesk' ? 'jsm' : productKey === 'jira-product-discovery' ? 'jpd' : null;
        if (productId) approxByProduct[productId] = out.value.total;
      }
    }

    const jiraMemberships = new Map<string, WireUser[]>();
    for (const row of jiraMemberRows) {
      const arr = jiraMemberships.get(row.groupId) ?? [];
      arr.push({ accountId: row.accountId, displayName: null, active: null, emailHint: null, accountType: null, createdDate: null });
      jiraMemberships.set(row.groupId, arr);
    }
    const confluenceMembership = new Map<string, WireUser[]>();
    for (const row of confMemberRows) {
      const arr = confluenceMembership.get(row.groupId) ?? [];
      arr.push({ accountId: row.accountId, displayName: null, active: null, emailHint: null, accountType: null, createdDate: null });
      confluenceMembership.set(row.groupId, arr);
    }
    const jiraGroupNames = new Map<string, string>();
    const confluenceGroupNames = new Map<string, string>();
    for (const gn of groupNames) {
      (gn.productId === 'jira' ? jiraGroupNames : confluenceGroupNames).set(gn.groupId, gn.groupName);
    }

    const orgById = new Map<string, WireOrgUser>();
    if (this.deps.gateway.orgConfigured()) {
      for (const o of orgUsers) if (o.accountId) orgById.set(o.accountId, o);
    }

    const streams: StreamAcquisition[] = STREAM_IDS.filter((id) => id !== 'orgUsers' || this.deps.gateway.orgConfigured()).map((id) => {
      const sp = rec.streams[id];
      const state: StreamAcquisition['state'] =
        sp.state === 'PENDING'
          ? id === 'orgUsers'
            ? 'OK'
            : 'DEGRADED'
          : sp.state === 'RUNNING'
            ? 'DEGRADED'
            : sp.state;
      return {
        streamId: id,
        state,
        reason: sp.reason ?? (sp.state !== 'OK' ? `stream not drained (state=${sp.state})` : null),
      };
    });

    const snap: AcquisitionSnapshot = {
      scanId: rec.scanId,
      dataMode: rec.dataMode,
      generatedAtIso: rec.createdAtIso, // deterministic anchor across resumed chunks
      users,
      jiraMemberships,
      jiraGroupNames,
      roles: (rolesOut && rolesOut.ok && rolesOut.value ? rolesOut.value : []) as WireApplicationRole[],
      plansRaw: plansOut && plansOut.ok ? plansOut.value : null,
      approxSeatTotals: approxByProduct,
      issueActivityHits: issueHits,
      issueActivityDrained: rec.streams.issueSweep.state === 'OK',
      issueActivityDegradedReason: rec.streams.issueSweep.reason,
      confluenceContributions: buildContributionMap(contribs, rec),
      confluenceGroupNames,
      confluenceMembership,
      orgUsersById: this.deps.gateway.orgConfigured() ? orgById : null,
      streams,
      renewalConfig: await this.getRenewalConfig(),
    };

    const report = deriveReport(snap);
    rec.report = report;
    rec.status = report.status;
    rec.updatedAtIso = this.iso();
    this.log(
      `scan ${report.status} id=${rec.scanId} safe=$${Math.floor(report.totals.safeNowAnnualCents / 100)} review=$${Math.floor(report.totals.reviewPoolAnnualCents / 100)}`,
    );
    return rec;
  }
}

function windowStartFor(rec: ScanRecord, nowMs: () => number): string {
  void nowMs;
  return new Date(Date.parse(rec.createdAtIso) - OBSERVATION_WINDOW_DAYS * 86_400_000).toISOString();
}

function buildContributionMap(
  contribs: import('../gateway/types').WireContributionHit[],
  rec: ScanRecord,
): Map<string, { hits: import('../gateway/types').WireContributionHit[]; complete: boolean }> {
  const m = new Map<string, { hits: import('../gateway/types').WireContributionHit[]; complete: boolean }>();
  const streamOk = rec.streams.contributionQueries.state === 'OK';
  for (const c of contribs) {
    const key = c.contributorAccountId ?? '';
    const entry = m.get(key) ?? { hits: [], complete: true };
    if (c.lastModified) {
      entry.hits.push(c);
    } else if (c.contentId !== null) {
      // A real content hit whose temporal field is missing/unparseable is
      // UNVERIFIABLE evidence (ERR-6), not absence: the account's sweep can
      // no longer claim complete coverage. Zero-hit sentinel rows
      // (contentId === null) are the only rows that may certify absence.
      entry.complete = false;
    }
    m.set(key, entry);
  }
  if (!streamOk) {
    for (const [, v] of m) v.complete = false;
  }
  return m;
}
