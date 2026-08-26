#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

const fail = (message) => {
  console.error(`  FAIL  marketplace-readiness: ${message}`);
  process.exitCode = 1;
};

let state;
let attestations;
let manifest;
try {
  state = JSON.parse(readFileSync('state/factory_direction.json', 'utf8'));
  attestations = JSON.parse(readFileSync('state/human_release_attestations.json', 'utf8'));
  manifest = parse(readFileSync('manifest.yml', 'utf8'));
} catch (error) {
  console.error(`  FAIL  marketplace-readiness: unreadable release evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!existsSync('docs/MARKETPLACE_RELEASE_CHECKLIST.md')) fail('missing Marketplace release checklist');
if (!existsSync('docs/RELEASE_STATUS.md')) fail('missing release status document');

if (state.release_status !== 'MARKETPLACE_READY') {
  if (state.continue !== true) fail(`unfinished status ${state.release_status ?? 'UNKNOWN'} must keep continue=true`);
  else console.log(`  PASS  marketplace-readiness: unfinished ${state.release_status}; automation must continue`);
} else {
  if (state.continue !== false) fail('MARKETPLACE_READY must set continue=false');

  const requiredTrue = [
    'partner_identity_verification_confirmed',
    'security_contact_confirmed',
    'privacy_security_tab_confirmed',
    'marketplace_partner_terms_confirmed',
  ];
  for (const key of requiredTrue) {
    if (attestations[key] !== true) fail(`human attestation not confirmed: ${key}`);
  }

  const privacy = attestations.privacy_policy_public_url;
  if (typeof privacy !== 'string' || !/^https:\/\//i.test(privacy)) {
    fail('privacy_policy_public_url must be a real HTTPS URL');
  }
  if (typeof attestations.confirmed_at !== 'string' || Number.isNaN(Date.parse(attestations.confirmed_at))) {
    fail('human attestations require a valid confirmed_at timestamp');
  }

  const appId = manifest?.app?.id;
  if (typeof appId !== 'string' || !appId.startsWith('ari:cloud:ecosystem::app/')) {
    fail('Marketplace-ready manifest lacks a registered Forge app id');
  }
  if (/0{8}-0{4}-0{4}-0{4}-0{12}|ATLAS_PLACEHOLDER/.test(appId)) {
    fail('Marketplace-ready manifest still uses the pre-registration app id sentinel');
  }

  if (!process.exitCode) console.log('  PASS  marketplace-readiness: protected human and registration evidence satisfied');
}

if (process.exitCode) process.exit(process.exitCode);
