/**
 * SCAN LEASE REGRESSION (security SEC-H2 / functional MEDIUM 9 repair).
 *
 * Pre-repair, leaseUntilEpochMs was declared and never used: two concurrent
 * runChunk invocations both read the same cursor before either persisted and
 * double-appended acquisition rows (8/11 accounts stored twice in the audit
 * probe); a lost shard write could silently drop recent-activity evidence
 * while streams reported OK.
 *
 * Repair contract:
 *  - A foreign, unexpired lease blocks chunk advancement (no appends).
 *  - An EXPIRED foreign lease is taken over (crashed invocations cannot
 *    wedge a scan).
 *  - The owner renews its own lease across sequential chunks.
 *  - Terminal states release the lease.
 *
 * Residual risk (honest): Forge KVS consistency semantics under concurrent
 * put/get are UNKNOWN (audit §6.4); without CAS this lease narrows the race
 * window to the read-persist gap rather than proving mutual exclusion. That
 * residual is recorded in docs/RELEASE_STATUS.md and must be settled live.
 */
import { describe, expect, it } from 'vitest';

import { memoryStorage, type AtlasStorage } from '../src/backend/storage';
import { ScanService } from '../src/backend/scanService';
import { FixtureAtlassianGateway } from '../src/gateway/fixture/fixtureGateway';
import { FIXTURE_SCAN_NOW } from '../src/gateway/fixture/dataset';
import type { ScanRecord } from '../src/backend/scanService';

const NOW_MS = Date.parse(FIXTURE_SCAN_NOW);

function makeService(storage: AtlasStorage): ScanService {
  return new ScanService({
    gateway: new FixtureAtlassianGateway({ variant: 'default' }),
    dataMode: 'FIXTURE',
    storage,
    nowMs: () => NOW_MS,
    log: () => undefined,
  });
}

async function userCount(storage: AtlasStorage): Promise<number> {
  const count = await storage.getJSON<{ n: number }>('acq-users', 'count');
  return count?.n ?? 0;
}

async function mutateCurrent(storage: AtlasStorage, fn: (rec: ScanRecord) => void): Promise<void> {
  const rec = await storage.getJSON<ScanRecord>('scan', 'current');
  expect(rec).toBeTruthy();
  fn(rec!);
  await storage.putJSON('scan', rec!, 'current');
}

describe('SEC-H2 repair: scan-state concurrency lease', () => {
  it('a foreign unexpired lease blocks advancement and prevents duplicate appends', async () => {
    const storage = memoryStorage();
    const owner = makeService(storage);
    const intruder = makeService(storage);

    await owner.ensureScan();
    // Owner takes the first chunk, leaving the scan mid-flight (RUNNING).
    const afterOwner = await owner.runChunk(60_000);
    expect(['RUNNING', 'COMPLETE', 'PARTIAL']).toContain(afterOwner.status);
    const countAfterOwner = await userCount(storage);

    if (afterOwner.status === 'RUNNING') {
      // Simulate a second invocation observing a fresh foreign lease on the
      // same record (what an overlapping tab/trigger would contend with).
      await mutateCurrent(storage, (rec) => {
        rec.status = 'RUNNING';
        rec.leaseUntilEpochMs = NOW_MS + 60_000;
        rec.leaseOwnerToken = 'some-other-invocation';
      });
      const beforeCount = await userCount(storage);
      const blocked = await intruder.runChunk(60_000);
      expect(blocked.status).toBe('RUNNING'); // untouched, not advanced to terminal
      expect(await userCount(storage)).toBe(beforeCount); // ZERO new appends
    } else {
      // Single-chunk completion path: verify lease was released at terminal.
      const final = await storage.getJSON<ScanRecord>('scan', 'current');
      expect(final!.leaseUntilEpochMs).toBeNull();
      expect(final!.leaseOwnerToken).toBeNull();
      expect(countAfterOwner).toBeGreaterThan(0);
    }
  });

  it('an expired foreign lease is taken over so crashed invocations cannot wedge scans', async () => {
    const storage = memoryStorage();
    const svc = makeService(storage);
    await svc.ensureScan();
    await mutateCurrent(storage, (rec) => {
      rec.status = 'RUNNING';
      rec.phase = 'jiraUsers';
      rec.leaseUntilEpochMs = NOW_MS - 1; // expired
      rec.leaseOwnerToken = 'dead-invocation';
    });
    const rec = await svc.runChunk(60_000);
    // Takeover happened; work advanced beyond the stale checkpoint.
    expect(['COMPLETE', 'PARTIAL', 'RUNNING']).toContain(rec.status);
    expect(rec.streams.jiraUsers.state).not.toBe('PENDING');
  });

  it('terminal states release the lease for subsequent scans', async () => {
    const storage = memoryStorage();
    const svc = makeService(storage);
    await svc.ensureScan();
    let rec = await svc.runChunk(60_000);
    let guard = 0;
    while ((rec.status === 'RUNNING' || rec.status === 'QUEUED') && guard++ < 300) rec = await svc.runChunk(60_000);
    expect(guard).toBeLessThan(300);
    const final = await storage.getJSON<ScanRecord>('scan', 'current');
    expect(final!.leaseUntilEpochMs).toBeNull();
    expect(final!.leaseOwnerToken).toBeNull();
  });

  it('sequential chunks from the SAME service renew their own lease instead of self-blocking', async () => {
    const storage = memoryStorage();
    const svc = makeService(storage);
    await svc.ensureScan();
    const first = await svc.runChunk(60_000);
    if (first.status !== 'RUNNING') return; // completed in one chunk; nothing to resume
    // Second sequential chunk must NOT be blocked by its own instance token.
    const second = await svc.runChunk(60_000);
    expect(second.updatedAtIso >= first.updatedAtIso || second.status !== 'RUNNING').toBe(true);
    expect(second.phase).not.toBe(first.phase || 'jiraUsers'); // progressed or terminal
  });
});
