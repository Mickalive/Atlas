/**
 * GATE-5 — partial/error semantics + transport discipline
 * (ERR-1..ERR-7, API_FEASIBILITY.md section 5).
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PACING,
  nextRetryDelay,
  parseRetryAfterSeconds,
  seededRng,
} from '../src/gateway/pacing';
import { adaptOutcome, parseWireUsers } from '../src/gateway/adapters';
import { ForgeAtlassianGateway } from '../src/gateway/forge/forgeGateway';
import type { PageCursor } from '../src/gateway/types';
import type { RawTransportResponseLike } from '../src/gateway/types';

const rng = () => seededRng(1)();

describe('Retry-After is honored as a floor (ERR-4)', () => {
  it('uses Retry-After when larger than backoff', () => {
    const decision = nextRetryDelay(
      1,
      { status: 429, headers: { 'retry-after': '7' }, json: null },
      DEFAULT_PACING,
      rng,
    );
    expect(decision.retry).toBe(true);
    expect(decision.delayMs).toBeGreaterThanOrEqual(7000);
  });

  it('keeps exponential backoff when Retry-After is smaller', () => {
    const decision = nextRetryDelay(2, { status: 429, headers: { 'retry-after': '0' }, json: null }, DEFAULT_PACING, rng);
    expect(decision.delayMs).toBeGreaterThan(0);
    expect(decision.delayMs).toBeLessThanOrEqual(DEFAULT_PACING.maxDelayMs);
  });

  it('parses beta retry-after headers too', () => {
    expect(parseRetryAfterSeconds({ status: 200, headers: { 'Beta-Retry-After': '3' }, json: null })).toBe(3);
  });
});

describe('backoff ceilings and determinism', () => {
  it('never exceeds maxDelayMs and stays within jitter bounds', () => {
    let retried = 0;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const d = nextRetryDelay(attempt, { status: 500, headers: {}, json: null }, DEFAULT_PACING, rng);
      if (!d.retry) {
        expect(attempt).toBe(DEFAULT_PACING.maxAttempts); // exactly at the ceiling
        expect(retried).toBe(DEFAULT_PACING.maxAttempts - 1);
        break;
      }
      retried += 1;
      expect(d.delayMs).toBeLessThanOrEqual(DEFAULT_PACING.maxDelayMs);
    }
  });

  it('is deterministic under a fixed seed', () => {
    const a = nextRetryDelay(1, { status: 429, headers: {}, json: null }, DEFAULT_PACING, seededRng(42));
    const b = nextRetryDelay(1, { status: 429, headers: {}, json: null }, DEFAULT_PACING, seededRng(42));
    expect(a.delayMs).toBe(b.delayMs);
  });
});

describe('retry classification', () => {
  it('never retries 401/403 (permission-partial instead)', () => {
    for (const status of [401, 403]) {
      const d = nextRetryDelay(0, { status, headers: {}, json: null }, DEFAULT_PACING, rng);
      expect(d.retry).toBe(false);
    }
  });

  it('never retries other 4xx', () => {
    expect(nextRetryDelay(0, { status: 404, headers: {}, json: null }, DEFAULT_PACING, rng).retry).toBe(false);
  });

  it('stops after the attempt ceiling', () => {
    const d = nextRetryDelay(DEFAULT_PACING.maxAttempts, { status: 429, headers: {}, json: null }, DEFAULT_PACING, rng);
    expect(d.retry).toBe(false);
  });
});

describe('adapter-level malformed preservation (ERR-6)', () => {
  it('marks unparseable bodies as malformed, not empty-ok', () => {
    const out = adaptOutcome({ status: 200, headers: {}, json: null }, parseWireUsers);
    expect(out.ok).toBe(false);
    expect(out.malformed).toBe(true);
  });

  it('maps 403 to permission-degraded outcome without value', () => {
    const out = adaptOutcome({ status: 403, headers: {}, json: { values: [] } }, parseWireUsers);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.value).toBeNull();
  });

  it('surfaces rate-limit metadata on 429 envelopes', () => {
    const out = adaptOutcome(
      { status: 429, headers: { 'retry-after': '5', 'ratelimit-reason': 'jira-quota-global-based' }, json: null },
      parseWireUsers,
    );
    expect(out.rateLimit?.retryAfterSec).toBe(5);
    expect(out.rateLimit?.reason).toBe('jira-quota-global-based');
  });
});

describe('production gateway central pacing with injectable transport', () => {
  function makeGateway(responses: RawTransportResponseLike[], sleepLog: number[] = []): ForgeAtlassianGateway {
    let call = 0;
    return new ForgeAtlassianGateway({
      seed: 7,
      sleepFn: async (ms) => {
        sleepLog.push(ms);
      },
      transport: {
        async request() {
          const r = responses[Math.min(call, responses.length - 1)];
          call += 1;
          return r;
        },
      },
    });
  }

  it('retries 429 honoring Retry-After then succeeds', async () => {
    const sleeps: number[] = [];
    const gw = makeGateway(
      [
        { status: 429, headers: { 'retry-after': '1' }, json: null },
        { status: 200, headers: {}, json: [{ key: 'jira-software', name: 'Jira Software', groupDetails: [{ id: 'g1', name: 'G1' }], userCount: 5 }] },
      ],
      sleeps,
    );
    const out = await gw.listJiraApplicationRoles();
    expect(out.ok).toBe(true);
    expect(out.value?.[0].roleKey).toBe('jira-software');
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000); // Retry-After floor respected
  });

  it('exhausts retries on persistent 5xx and returns last outcome (no infinite loop)', async () => {
    const sleeps: number[] = [];
    const gw = makeGateway([{ status: 503, headers: {}, json: null }], sleeps);
    const out = await gw.getInstanceLicensePlans();
    expect(out.ok).toBe(false);
    expect(out.status).toBe(503);
    expect(sleeps.length).toBe(DEFAULT_PACING.maxAttempts - 1);
  });

  it('falls back to asUser once after a 401 when interactive fallback is enabled', async () => {
    const identities: string[] = [];
    const gw = new ForgeAtlassianGateway({
      userFallback: true,
      seed: 3,
      sleepFn: async () => undefined,
      transport: {
        async request(req) {
          identities.push(req.identity.mode);
          if (req.identity.mode === 'asApp') return { status: 401, headers: {}, json: null };
          return {
            status: 200,
            headers: {},
            json: [{ key: 'jira-servicedesk', name: 'JSM', groupDetails: [], userCount: 2 }],
          };
        },
      },
    });
    const out = await gw.listJiraApplicationRoles();
    expect(out.ok).toBe(true);
    expect(identities).toEqual(['asApp', 'asUser']);
  });

  it('does NOT fall back to asUser by default (fail-closed identity mode)', async () => {
    const identities: string[] = [];
    const gw = new ForgeAtlassianGateway({
      seed: 3,
      sleepFn: async () => undefined,
      transport: {
        async request(req) {
          identities.push(req.identity.mode);
          return { status: 401, headers: {}, json: null };
        },
      },
    });
    await gw.getInstanceLicensePlans();
    expect(identities.every((m) => m === 'asApp')).toBe(true);
  });
});

describe('pagination envelope honesty', () => {
  it('honors returned page sizes and short-page stop conditions via fixture', async () => {
    const { FixtureAtlassianGateway } = await import('../src/gateway/fixture/fixtureGateway');
    const gw = new FixtureAtlassianGateway({ variant: 'default' });
    // Page sizes change mid-loop ([2, 3]); a drainer must follow returned sizes.
    const sizes: number[] = [];
    let cursor: PageCursor = {};
    for (let i = 0; i < 20; i += 1) {
      const page = await gw.listJiraUsers(cursor);
      sizes.push(page.values.length);
      if (page.meta.isLast !== false) break;
      cursor = page.meta.nextCursor
        ? { cursor: page.meta.nextCursor }
        : { startAt: (cursor.startAt ?? 0) + Math.max(1, page.meta.pageSize) , pageLimit: page.meta.pageSize };
    }
    expect(sizes.length).toBeGreaterThan(2);
    expect(new Set(sizes).size).toBeGreaterThan(1); // size actually changed mid-loop
    const total = sizes.reduce((a, b) => a + b, 0);
    expect(total).toBe(19); // 18 users + 1 deliberate duplicate record
  });
});
