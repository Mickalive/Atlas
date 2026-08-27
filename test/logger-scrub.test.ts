/**
 * LOG-1/LOG-2/TEN-5 — secret-safe, tenant-safe logging.
 */
import { describe, expect, it, vi } from 'vitest';

import { logger, scrubValue } from '../src/backend/logger';

describe('scrubValue (LOG-2)', () => {
  it('LOG-2a: redacts sensitive keys recursively', () => {
    const poisoned = {
      authorization: 'Bearer super-secret-token-value', // redact-test poison
      headers: { Authorization: 'Bearer abc', cookie: 'session=x' },
      nested: { api_key: 'AKIA123', ok: 'fine' },
      apiKey: 'org-key-material',
    };
    const out = scrubValue(poisoned) as Record<string, unknown>;
    expect(out.authorization).toBe('[redacted]');
    expect((out.headers as Record<string, unknown>).Authorization).toBe('[redacted]');
    expect((out.headers as Record<string, unknown>).cookie).toBe('[redacted]');
    expect(((out.nested) as Record<string, unknown>).api_key).toBe('[redacted]');
    expect(((out.nested) as Record<string, unknown>).ok).toBe('fine');
    expect(out.apiKey).toBe('[redacted]');
  });

  it('LOG-2b: redacts bearer-shaped string values even under innocent keys', () => {
    const out = scrubValue({ note: 'bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload' }) as { note: string };
    expect(out.note).toContain('[redacted]');
    expect(out.note).not.toContain('eyJ');
  });

  it('LOG-2c: bounds depth and array size so poisoned payloads cannot flood logs', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };
    const out = scrubValue(deep, 0) as typeof deep;
    expect(JSON.stringify(out)).toContain('depth-limit');
    const bigArray = Array.from({ length: 500 }, (_, i) => ({ v: i }));
    expect((scrubValue(bigArray) as unknown[]).length).toBe(50);
  });
});

describe('logger output hygiene', () => {
  it('LOG-1/LOG-2d: never emits raw credentials even when callers leak them in meta', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      logger.error('gateway failure', {
        endpoint: '/rest/api/3/users',
        responseHeaders: { Authorization: 'Bearer leaked-token-value-123456' }, // redact-test poison
        orgApiKey: 'ATLASSIAN_ORG_API_KEY_SHAPED_VALUE_1234567890',
        installationId: 'inst-9',
      });
      const line = errSpy.mock.calls[0]?.[0] as string;
      expect(line).not.toContain('leaked-token-value');
      expect(line).not.toContain('ORG_API_KEY_SHAPED');
      expect(line).toContain('inst-9'); // tenant-safe identifiers allowed (TEN-5)
      expect(line.split('\n').length).toBe(1); // no newline injection
    } finally {
      errSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  // SEC-M1 repair: LOG-2 binds at serialization level — the MESSAGE string
  // gets the same scrubbing as meta values, so interpolated credentials in
  // future call sites cannot leak verbatim.
  it('LOG-2e: never emits bearer-shaped credentials interpolated into the message itself', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      logger.error('upstream rejected Authorization: Bearer supersecretbearertokenvalue123456 retrying'); // redact-test poison
      const line = errSpy.mock.calls[0]?.[0] as string;
      expect(line).toContain('[redacted]');
      expect(line).not.toContain('supersecretbearertokenvalue');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('LOG-2f: scrubs long opaque token shapes in messages while keeping ordinary prose', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      logger.warn('token=abcdefghijklmnopqrstuvwx failed; user saw error message'); // redact-test poison
      const line = warnSpy.mock.calls[0]?.[0] as string;
      expect(line).not.toContain('abcdefghijklmnopqrstuvwx');
      expect(line).toContain('user saw error message');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
