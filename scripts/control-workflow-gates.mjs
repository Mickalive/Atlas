#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const paths = [
  '.github/workflows/atlas-factory.yml',
  '.github/workflows/atlas-factory-supervisor.yml',
  '.github/workflows/atlas-watchdog.yml',
  '.github/workflows/atlas-main-ci.yml',
];

const docs = new Map();
const failures = [];
const passes = [];

for (const path of paths) {
  try {
    const text = readFileSync(path, 'utf8');
    const doc = parse(text);
    if (!doc || typeof doc !== 'object') throw new Error('root is not an object');
    docs.set(path, { text, doc });
    passes.push(`workflow YAML parses: ${path}`);
  } catch (error) {
    failures.push(`workflow YAML invalid: ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const factory = docs.get('.github/workflows/atlas-factory.yml');
const supervisor = docs.get('.github/workflows/atlas-factory-supervisor.yml');
const watchdog = docs.get('.github/workflows/atlas-watchdog.yml');
const mainCi = docs.get('.github/workflows/atlas-main-ci.yml');

if (factory) {
  const on = factory.doc.on ?? {};
  if (on.schedule) failures.push('factory owns a direct schedule; continuity must remain external');
  else passes.push('factory has no blind direct cron');
  if (!factory.text.includes('install-opencode-with-retry.sh')) failures.push('factory lost resilient OpenCode installer');
  if (!factory.text.includes('run-opencode-with-retry.sh')) failures.push('factory lost resilient OpenCode execution wrapper');
  if (!factory.text.includes('factory/continuation')) failures.push('factory lost durable integration continuation checkpoint');
  if (!factory.text.includes('ATLAS_CONTINUATION_CHECKPOINT=RESUMED')) failures.push('builder lost checkpoint resume path');
  if (!factory.text.includes('Persist resumable integration checkpoint')) failures.push('integrator no longer persists WIP before hard gates');
  if (/release_status=\"LIVE_DEV_VERIFIED\"[^\n]*continue=false|PARITY_READY_AWAITING_CREDENTIALS[^\n]*continue=false/.test(factory.text)) {
    failures.push('factory can intentionally stop before Marketplace readiness');
  }
  if (!factory.text.includes('npm run audit:high --if-present')) failures.push('factory host gates lack high/critical dependency audit');
  else passes.push('factory resumes WIP and keeps unfinished state alive');
}

function hasFiveMinuteCron(entry) {
  const schedule = entry?.doc?.on?.schedule;
  return Array.isArray(schedule) && schedule.some((x) => x?.cron === '*/5 * * * *');
}

if (!supervisor || !hasFiveMinuteCron(supervisor)) failures.push('continuity supervisor is not scheduled every five minutes');
else passes.push('continuity supervisor five-minute heartbeat present');
if (!watchdog || !hasFiveMinuteCron(watchdog)) failures.push('watchdog is not scheduled every five minutes');
else passes.push('watchdog five-minute heartbeat present');

if (supervisor) {
  if (!supervisor.text.includes("STATUS\" == 'MARKETPLACE_READY'")) failures.push('supervisor lacks Marketplace-ready stop condition');
  if (!supervisor.text.includes('ATLAS_CONTINUITY=DISPATCH_FRESH_CYCLE')) failures.push('supervisor lacks fresh-cycle recovery dispatch');
  if (!supervisor.text.includes('ATLAS_CONTINUITY=STATE_SELF_HEALED')) failures.push('supervisor cannot self-heal prematurely stopped/corrupt state');
  if (/24h autonomous cycle cap|runaway busywork|RECENT.*-ge/i.test(supervisor.text)) failures.push('supervisor contains a run cap that can halt unfinished work');
  if (supervisor.doc?.permissions?.contents !== 'write' || supervisor.doc?.permissions?.actions !== 'write') {
    failures.push('supervisor lacks contents/actions write permissions required for self-heal + dispatch');
  } else passes.push('supervisor has self-heal and dispatch permissions');
}

if (watchdog) {
  for (const sig of ['unexpected server error', 'endpoint is unavailable', 'upstream request failed', 'UnknownError']) {
    if (!watchdog.text.toLowerCase().includes(sig.toLowerCase())) failures.push(`watchdog lost transient signature: ${sig}`);
  }
  if (!watchdog.text.includes('ATLAS_WATCHDOG=BACKUP_CONTINUITY_DISPATCH')) failures.push('watchdog lacks independent delayed continuity fallback');
  if (!watchdog.text.includes('dispatching fresh cycle')) failures.push('watchdog local retry exhaustion can become terminal');
  else passes.push('watchdog has bounded retry plus independent fresh-cycle fallback');
}

if (mainCi) {
  if (!mainCi.text.includes('npm run audit:high')) failures.push('main CI lacks high/critical npm advisory gate');
  if (!mainCi.text.includes('AUTHENTICATED FORGE LINT WHEN AVAILABLE')) failures.push('main CI lacks authenticated Forge lint hook');
  if (!mainCi.text.includes('tsconfig.frontend.json')) failures.push('main CI does not track frontend typecheck config changes');
  else passes.push('main CI covers frontend types, dependency audit and Forge auth hook');
}

try {
  const state = JSON.parse(readFileSync('state/factory_direction.json', 'utf8'));
  if (state.release_status === 'MARKETPLACE_READY') {
    if (state.continue !== false) failures.push('MARKETPLACE_READY must set continue=false');
  } else {
    if (state.continue !== true) failures.push('unfinished Atlas state must set continue=true');
    if (typeof state.next_focus !== 'string' || state.next_focus.trim() === '') failures.push('unfinished Atlas state lacks next_focus');
  }
  passes.push(`continuation state checked: ${state.release_status ?? 'UNKNOWN'}`);
} catch (error) {
  failures.push(`factory_direction.json invalid: ${error instanceof Error ? error.message : String(error)}`);
}

for (const line of passes) console.log(`  PASS  ${line}`);
if (failures.length) {
  for (const line of failures) console.error(`  FAIL  ${line}`);
  process.exit(1);
}
console.log('control/workflow gates: all green');
