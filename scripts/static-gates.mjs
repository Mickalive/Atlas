#!/usr/bin/env node
/**
 * Atlas static gates (run via `npm run lint` / `npm run build`).
 *
 * Implements the Builder-owned portions of docs/SECURITY_TEST_PLAN.md plus
 * current Forge manifest invariants verified against Atlassian docs.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';

const ROOT = new URL('..', import.meta.url).pathname;
const fail = [];
const ok = [];

function listFiles(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      listFiles(p, exts, acc);
    } else if (exts.some((e) => p.endsWith(e))) {
      acc.push(p);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Forge manifest structure + GATE-2 scope budget
// ---------------------------------------------------------------------------

const manifestPath = join(ROOT, 'manifest.yml');
const manifest = parse(readFileSync(manifestPath, 'utf8'));

// Current Forge requires app/modules/permissions as the core top-level shape.
if (!manifest?.app || typeof manifest.app !== 'object') {
  fail.push('forge-manifest: required top-level app object missing');
}
if (!manifest?.modules || typeof manifest.modules !== 'object') {
  fail.push('forge-manifest: required top-level modules object missing');
}
if (!manifest?.permissions || typeof manifest.permissions !== 'object') {
  fail.push('forge-manifest: required top-level permissions object missing');
}
if ('runtime' in (manifest ?? {})) {
  fail.push('forge-manifest: runtime must live under app.runtime, not top-level');
}
if ('licensing' in (manifest ?? {})) {
  fail.push('forge-manifest: licensing must live under app.licensing, not top-level');
}

const appId = manifest?.app?.id;
if (typeof appId !== 'string' || !/^ari:cloud:ecosystem::app\/[0-9a-f-]{36}$/i.test(appId)) {
  fail.push('forge-manifest: app.id must be a Forge app ARI (real or pre-registration sentinel)');
} else {
  ok.push(
    appId.endsWith('/00000000-0000-0000-0000-000000000000')
      ? 'forge-manifest: pre-registration app.id sentinel present'
      : 'forge-manifest: registered app.id shape present',
  );
}

const runtimeName = manifest?.app?.runtime?.name;
if (runtimeName !== 'nodejs24.x') fail.push(`parity: app.runtime.name must be nodejs24.x (got ${runtimeName})`);
else ok.push('parity: app.runtime.name nodejs24.x');

const memoryMB = manifest?.app?.runtime?.memoryMB;
if (memoryMB !== 512) fail.push(`parity: app.runtime.memoryMB must be 512 (got ${memoryMB})`);
else ok.push('parity: app.runtime.memoryMB 512');

if (!manifest?.app?.licensing?.enabled) {
  fail.push('forge-manifest: app.licensing.enabled missing (self-license detection)');
} else {
  ok.push('forge-manifest: app.licensing.enabled true');
}

// Modern UI Kit must use resource + render:native + resolver rather than the
// legacy direct-function adminPage shape.
const resources = Array.isArray(manifest?.resources) ? manifest.resources : [];
const resourceByKey = new Map(resources.map((r) => [r?.key, r]));
const adminPages = manifest?.modules?.['jira:adminPage'] ?? [];
if (!Array.isArray(adminPages) || adminPages.length !== 1) {
  fail.push(`forge-manifest: expected exactly one jira:adminPage, got ${Array.isArray(adminPages) ? adminPages.length : 'invalid'}`);
} else {
  const page = adminPages[0];
  if (!page?.resource || !resourceByKey.has(page.resource)) {
    fail.push('forge-manifest: jira:adminPage must reference a declared UI resource');
  }
  if (page?.render !== 'native') {
    fail.push('forge-manifest: modern UI Kit jira:adminPage must set render: native');
  }
  if (!page?.resolver?.function) {
    fail.push('forge-manifest: jira:adminPage must reference a resolver function');
  }
  if ('function' in (page ?? {})) {
    fail.push('forge-manifest: modern UI Kit jira:adminPage must not use legacy direct function property');
  }
}

for (const resource of resources) {
  if (typeof resource?.key !== 'string' || resource.key.length > 23) {
    fail.push(`forge-manifest: resource key invalid/too long: ${String(resource?.key)}`);
  }
  if (typeof resource?.path !== 'string' || !existsSync(join(ROOT, resource.path))) {
    fail.push(`forge-manifest: resource path missing: ${String(resource?.path)}`);
  }
}
if (!fail.some((f) => f.startsWith('forge-manifest: jira:adminPage')) && resources.length > 0) {
  ok.push('forge-manifest: modern UI Kit resource/adminPage wiring present');
}

const functions = Array.isArray(manifest?.modules?.function) ? manifest.modules.function : [];
const functionByKey = new Map(functions.map((f) => [f?.key, f]));
for (const fn of functions) {
  if (typeof fn?.key !== 'string' || fn.key.length > 23) {
    fail.push(`forge-manifest: function key invalid/too long: ${String(fn?.key)}`);
  }
  if (typeof fn?.handler !== 'string' || !/^index\.[A-Za-z0-9_-]+$/.test(fn.handler)) {
    fail.push(`forge-manifest: function handler must use src-root index.<export>: ${String(fn?.handler)}`);
  }
}
if (!existsSync(join(ROOT, 'src', 'index.ts')) && !existsSync(join(ROOT, 'src', 'index.js'))) {
  fail.push('forge-manifest: src-root index entrypoint missing');
}

const sched = manifest?.modules?.scheduledTrigger ?? [];
if (!Array.isArray(sched)) {
  fail.push('forge-manifest: scheduledTrigger must be an array');
} else {
  if (sched.length > 5) fail.push('feasibility: more than 5 scheduled triggers');
  for (const trigger of sched) {
    if (!['fiveMinute', 'hour', 'day', 'week'].includes(trigger?.interval)) {
      fail.push(`forge-manifest: unsupported scheduled interval ${String(trigger?.interval)}`);
    }
    const fn = functionByKey.get(trigger?.function);
    if (!fn) {
      fail.push(`forge-manifest: scheduled trigger references missing function ${String(trigger?.function)}`);
      continue;
    }
    const timeout = fn.timeoutSeconds;
    if (!Number.isInteger(timeout) || timeout < 800 || timeout > 900) {
      fail.push(`forge-manifest: scheduled worker timeoutSeconds must cover Atlas 800s chunk and be <=900 (got ${timeout})`);
    }
  }
}
if (!fail.some((f) => f.startsWith('forge-manifest: scheduled'))) {
  ok.push('forge-manifest: scheduled worker wiring + timeout valid');
}

const declaredScopes = manifest?.permissions?.scopes ?? [];
const SCOPE_ALLOWLIST = [
  'read:license:jira',
  'read:application-role:jira',
  'read:user:jira',
  'read:group:jira',
  'read:avatar:jira',
  'read:jira-work', // deviation recorded: docs/API_FEASIBILITY_ADDENDUM.md (VERIFY-LIVE)
  'read:content-details:confluence',
  'read:user:confluence',
  'read:group:confluence',
];

for (const scope of declaredScopes) {
  if (!SCOPE_ALLOWLIST.includes(scope)) {
    fail.push(`GATE-2/BLK-5: manifest declares non-allowlisted scope '${scope}'`);
  }
}
for (const allowed of SCOPE_ALLOWLIST) {
  if (!declaredScopes.includes(allowed)) {
    fail.push(`GATE-2: allowlisted scope '${allowed}' missing from manifest (budget mismatch)`);
  }
}
ok.push(`GATE-2: manifest scope set equals verified budget (${declaredScopes.length} scopes)`);

// --- GATE-2 usage proof (SEC-H1) -------------------------------------------
function extractScopeBudgetCalls(source) {
  const block = source.match(/export const SCOPE_BUDGET[\s\S]*?= \{([\s\S]*?)\n\};/);
  if (!block) return null;
  const calls = {};
  const entryRe = /'([^']+)':\s*\{([^{}]*)\}/g;
  let m;
  while ((m = entryRe.exec(block[1])) !== null) {
    const scope = m[1];
    const body = m[2];
    const callsMatch = body.match(/calls:\s*\[([^\]]*)\]/);
    if (!callsMatch) continue;
    calls[scope] = callsMatch[1]
      .split(',')
      .map((s) => s.trim().replaceAll("'", ''))
      .filter((s) => s.length > 0);
  }
  return calls;
}

let budgetCalls = null;
try {
  const typesSource = readFileSync(join(ROOT, 'src', 'gateway', 'types.ts'), 'utf8');
  budgetCalls = extractScopeBudgetCalls(typesSource);
} catch {
  fail.push('GATE-2/SEC-H1: could not read src/gateway/types.ts for scope-budget usage analysis');
}

if (budgetCalls !== null) {
  const transportSources = ['src/gateway/forge/forgeGateway.ts', 'src/gateway/fixture/fixtureGateway.ts']
    .map((p) => readFileSync(join(ROOT, p), 'utf8'))
    .join('\n');
  for (const scope of declaredScopes) {
    const exercisedBy = budgetCalls[scope];
    if (!exercisedBy || exercisedBy.length === 0) {
      fail.push(`GATE-2/SEC-H1: manifest scope '${scope}' has no SCOPE_BUDGET entry with exercising calls`);
      continue;
    }
    const anyCallSite = exercisedBy.some((name) =>
      new RegExp(`\\b${name}\\s*\\(`).test(transportSources),
    );
    if (!anyCallSite) {
      fail.push(
        `GATE-2/SEC-H1: scope '${scope}' declares exercising call(s) [${exercisedBy.join(', ')}] but none exist in any transport implementation`,
      );
    }
  }
  for (const scope of Object.keys(budgetCalls)) {
    if (!declaredScopes.includes(scope)) {
      fail.push(`GATE-2/SEC-H1: SCOPE_BUDGET exercises '${scope}' but the manifest does not declare it`);
    }
  }
  if (!fail.some((f) => f.startsWith('GATE-2/SEC-H1'))) {
    ok.push('GATE-2/SEC-H1: every manifest scope is exercised by a real gateway call site');
  }
}

// ---------------------------------------------------------------------------
// GATE-4 / AC10: fixture hygiene + mode-conditionals + purity
// ---------------------------------------------------------------------------

const coreDir = join(ROOT, 'src', 'core');
const coreFiles = listFiles(coreDir, ['.ts']);
const FORBIDDEN_CORE_TOKENS = [/ATLAS_DATA_MODE/, /process\.env/, /selectDataMode/, /require\(/];

for (const file of coreFiles) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  const stripped = text.replaceAll('FIXTURE', '').replaceAll('"FIXTURE"', '');
  if (/fixture|Fixture/i.test(stripped)) {
    fail.push(`GATE-4/FIX-6: engine module contains sample-data literal: ${rel}`);
  }
  if (/@forge\//.test(text)) {
    fail.push(`purity: core module imports @forge/*: ${rel}`);
  }
  if (/from ['"]node:/.test(text)) {
    fail.push(`purity: core module imports node: builtin: ${rel}`);
  }
  for (const re of FORBIDDEN_CORE_TOKENS) {
    if (re.test(text)) {
      fail.push(`AC10: core module contains forbidden mode-selection token ${re}: ${rel}`);
    }
  }
}
if (!fail.some((f) => f.startsWith('GATE-4'))) ok.push('GATE-4: engine tree free of sample-data literals');
if (!fail.some((f) => f.startsWith('AC10'))) ok.push('AC10: no activation-mode conditionals in core modules');
if (!fail.some((f) => f.startsWith('purity'))) ok.push('purity: core imports clean');

// ADV-3: production entrypoints must not reach the sample transport or dev harness.
const prodDirs = [join(ROOT, 'src', 'backend'), join(ROOT, 'src', 'frontend')];
for (const dir of prodDirs) {
  const files = listFiles(dir, ['.ts', '.tsx', '.jsx', '.js']);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    const importRe = /from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(text)) !== null) {
      const spec = m[1] ?? m[2] ?? '';
      if (/gateway\/fixture/.test(spec) || /^dev\/|\/dev\//.test(spec)) {
        fail.push(`ADV-3/BLK-3: production entrypoint imports sample/dev module '${spec}': ${rel}`);
      }
    }
    if (/ATLAS_DATA_MODE/.test(text)) {
      fail.push(`FIX-1/ADV-3: production entrypoint reads data-mode env: ${rel}`);
    }
  }
}
if (!fail.some((f) => f.startsWith('ADV-3'))) ok.push('ADV-3: production entrypoints cannot reach sample transport');

// ---------------------------------------------------------------------------
// LOG-3: secret patterns (extends .github/scripts/forge-parity-check.sh)
// ---------------------------------------------------------------------------

const scanTargets = [
  ...listFiles(join(ROOT, 'src'), ['.ts', '.tsx', '.jsx', '.js']),
  ...listFiles(join(ROOT, 'test'), ['.ts']),
  ...listFiles(join(ROOT, 'scripts'), ['.mjs', '.js']),
];
const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{20,}/, 'OpenAI-shaped key'],
  [/ATLASSIAN_ORG_API_KEY\s*[:=]\s*['"][^'\s]{16,}['"]/, 'org API key literal'],
  [/FORGE_API_TOKEN\s*[:=]\s*['"][A-Za-z0-9_-]{8,}['"]/, 'Forge API token literal'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{24,}/, 'hard-coded bearer token'],
];
for (const file of scanTargets) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/scrub|redact/i.test(line)) return;
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(line)) {
        fail.push(`LOG-3/BLK-6: possible ${label} at ${rel}:${i + 1}`);
      }
    }
  });
}
if (!fail.some((f) => f.startsWith('LOG-3'))) ok.push('LOG-3: secret pattern scan clean');

console.log('');
for (const line of ok) console.log(`  PASS  ${line}`);
if (fail.length > 0) {
  console.error('');
  for (const line of fail) console.error(`  FAIL  ${line}`);
  console.error(`\nstatic gates: ${fail.length} violation(s)`);
  process.exit(1);
}
console.log('\nstatic gates: all green\n');
