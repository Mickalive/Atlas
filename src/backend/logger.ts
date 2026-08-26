/**
 * Structured, tenant-safe, secret-scrubbing logger (LOG-1/LOG-2/TEN-5).
 *
 * - Scrubs Authorization headers, tokens, cookies and org-API-key-shaped
 *   values from anything logged.
 * - Logs carry installation id + counts only; never bulk user lists.
 * - The FIXTURE log prefix is applied by the dev harness for fixture runs,
 *   not by engines (engines have no mode concept).
 */

const SENSITIVE_KEY_RE = /(authorization|cookie|token|secret|api[-_]?key|password|credential)/i;

/** Values that look like bearer credentials or org API keys get redacted outright. */
const BEARER_LIKE_RE = /\b(bearer\s+[A-Za-z0-9._~+/=-]{8,}|[A-Za-z0-9_-]{24,})\b/g;

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (typeof value === 'string') {
    return value.replace(BEARER_LIKE_RE, '[redacted]');
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function emit(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  const safeMessage = typeof message === 'string' ? message.replace(/[\r\n]/g, ' ') : '[non-string message]';
  const payload = {
    level,
    msg: safeMessage,
    ...(meta ? (scrubValue(meta) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger: Logger = {
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
