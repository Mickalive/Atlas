#!/usr/bin/env node
/**
 * Atlas static gates (run via `npm run lint` / `npm run build`).
 *
 * Implements the Builder-owned portions of docs/SECURITY_TEST_PLAN.md:
 *  - GATE-2  scope budget: manifest scopes == verified allowlist, each
 *            exercised by a named gateway call (SEC-2a / BLK-5).
 *  - GATE-4  fixture hygiene: no sample-data literals inside engine modules,
 *            fixture transport unreachable from production entrypoints (ADV-3),
 *            no activation-mode conditionals in core modules (AC10).
 *  - Purity  core modules import no SDK/transport/node built-ins.
 *  - LOG-3   extended secret patterns beyond the parity script.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'yaml';

const ROOT = new URL('..', import.meta.url).pathname;
const fail = [];
const ok = [];

function listFiles(dir, exts, acc = []) {
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
// GATE-2: scope budget
// ---------------------------------------------------------------------------

const manifestPath = join(ROOT, 'manifest.yml');
const manifest = parse(readFileSync(manifestPath, 'utf8'));

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
// Set equality alone cannot detect a declared-but-never-exercised scope: a
// probe added one scope string in three documentation locations and stayed
// green. Each manifest scope must therefore map to a SCOPE_BUDGET entry whose
// `calls` include at least one name that appears as an actual call site in a
// transport implementation. A scope exercised by no real call fails here.

function extractScopeBudgetCalls(source) {
  const block = source.match(/export const SCOPE_BUDGET[\s\S]*?= \{([\s\S]*?)\n\};/);
  if (!block) return null;
  const calls = {};
  // Entries may be single-line or multi-line; bodies contain no nested braces.
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

const runtimeName = manifest?.runtime?.name;
if (runtimeName !== 'nodejs24.x') fail.push(`parity: runtime must be nodejs24.x (got ${runtimeName})`);
else ok.push('parity: runtime nodejs24.x');
if (!manifest?.licensing?.enabled) fail.push('manifest: licensing.enabled missing (self-license detection per feasibility row 14)');
else ok.push('manifest: licensing.enabled true');
const sched = manifest?.modules?.scheduledTrigger ?? [];
if (sched.length > 5) fail.push('feasibility 2.3: more than 5 scheduled triggers');

// ---------------------------------------------------------------------------
// GATE-4 / AC10: fixture hygiene + mode-conditionals + purity
// ---------------------------------------------------------------------------

const coreDir = join(ROOT, 'src', 'core');
const coreFiles = listFiles(coreDir, ['.ts']);
const FORBIDDEN_CORE_TOKENS = [/ATLAS_DATA_MODE/, /process\.env/, /selectDataMode/, /require\(/];

for (const file of coreFiles) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  // Remove the exact provenance enum token before scanning for mode words.
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
    // The scrubber/logger may mention pattern shapes; ignore redaction code.
    if (/scrub|redact/i.test(line)) return;
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(line)) {
        fail.push(`LOG-3/BLK-6: possible ${label} at ${rel}:${i + 1}`);
      }
    }
  });
}
if (!fail.some((f) => f.startsWith('LOG-3'))) ok.push('LOG-3: secret pattern scan clean');

// ---------------------------------------------------------------------------

console.log('');
for (const line of ok) console.log(`  PASS  ${line}`);
if (fail.length > 0) {
  console.error('');
  for (const line of fail) console.error(`  FAIL  ${line}`);
  console.error(`\nstatic gates: ${fail.length} violation(s)`);
  process.exit(1);
}
console.log('\nstatic gates: all green\n');
