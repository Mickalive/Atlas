/**
 * Centralized transport pacing policy (API_FEASIBILITY.md §5).
 *
 * Binding behavior:
 *  - Honor `Retry-After` as the MINIMUM delay.
 *  - Exponential backoff with jitter in [0.7, 1.3].
 *  - Retry ceiling: 4 attempts total, then the stream marks failed-not-fatal.
 *  - 401/403 => permission-partial (recorded, never retried as-is).
 *  - 5xx retried only because all Atlas reads are idempotent GETs.
 *  - Deterministic under injected clock/sleep/rng (tests simulate 429/5xx).
 */

import type { RawTransportResponseLike } from './types';

export type RawTransportResponse = RawTransportResponseLike;

export interface PacingConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterLow: number;
  jitterHigh: number;
}

export const DEFAULT_PACING: PacingConfig = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitterLow: 0.7,
  jitterHigh: 1.3,
};

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}

/** Mulberry32 — tiny deterministic PRNG so tests can pin jitter. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function headerValue(headers: Record<string, string>, nameLower: string): string | null {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === nameLower) return v;
  }
  return null;
}

export function parseRetryAfterSeconds(response: RawTransportResponse): number | null {
  const ra = headerValue(response.headers, 'retry-after');
  if (ra !== null) {
    const n = Number(ra);
    if (Number.isFinite(n) && n >= 0) return n;
    const asDate = Date.parse(ra);
    if (Number.isFinite(asDate)) {
      return Math.max(0, Math.round((asDate - Date.now()) / 1000));
    }
  }
  const beta = headerValue(response.headers, 'beta-retry-after');
  if (beta !== null) {
    const n = Number(beta);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * Decide whether/how long to wait before the next attempt.
 * Pure given rng — no hidden state.
 */
export function nextRetryDelay(
  attempt: number,
  response: RawTransportResponse | null,
  config: PacingConfig,
  rng: () => number,
): RetryDecision {
  if (attempt >= config.maxAttempts) return { retry: false, delayMs: 0 };

  const status = response?.status ?? 0;

  // Never retry permission problems or client errors other than 429.
  if (status === 401 || status === 403) return { retry: false, delayMs: 0 };
  if (status >= 400 && status < 500 && status !== 429) return { retry: false, delayMs: 0 };
  if (status === 0) return { retry: false, delayMs: 0 }; // transport-level abort

  const retryAfterSec = response ? parseRetryAfterSeconds(response) : null;
  const exponential = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)),
  );
  const jitter = config.jitterLow + rng() * (config.jitterHigh - config.jitterLow);
  const backoffMs = Math.min(config.maxDelayMs, Math.round(exponential * jitter));
  // Retry-After is a floor, not a suggestion.
  const delayMs = retryAfterSec !== null ? Math.max(retryAfterSec * 1000, backoffMs) : backoffMs;
  return { retry: true, delayMs };
}
