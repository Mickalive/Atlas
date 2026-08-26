/**
 * Development-harness data-mode selection (FIX-1).
 *
 * LIVE is the default. Fixture mode requires an EXPLICIT opt-in via
 * ATLAS_DATA_MODE=fixture in a development/test process. Auto-detection is
 * forbidden. This module is imported ONLY by the dev harness and tests —
 * never by production entrypoints (ADV-3, enforced statically).
 */

import type { DataMode } from '../core/types';

export function selectDataMode(env: NodeJS.ProcessEnv): { mode: Extract<DataMode, 'LIVE' | 'FIXTURE'>; source: string } {
  const raw = env.ATLAS_DATA_MODE;
  if (raw === undefined || raw === '' || raw.toLowerCase() === 'live') {
    return { mode: 'LIVE', source: 'default' };
  }
  if (raw.toLowerCase() === 'fixture') {
    return { mode: 'FIXTURE', source: 'explicit env' };
  }
  throw new Error(`invalid ATLAS_DATA_MODE value; use live|fixture (got ${JSON.stringify(raw)})`);
}
