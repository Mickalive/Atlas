# Atlas Marketplace release checklist

This checklist is evidence-driven. It is not permission for an autonomous agent to mark a human or Atlassian-owned requirement complete.

## Stop rule

`MARKETPLACE_READY` is the only autonomous stop state. It is forbidden until every technical release gate is green **and** every protected human attestation in `state/human_release_attestations.json` is genuinely satisfied.

## Technical gates — automate and keep iterating

- [ ] Current `main` deterministic CI is green: tests, backend typecheck, UI Kit JSX typecheck, static/control-plane gates, build.
- [ ] `npm audit --audit-level=high` is green. Atlassian's cloud-app security requirements prohibit dependencies with known high or critical vulnerabilities.
- [ ] Forge parity is green under Node 24 / 512 MB with production entrypoints isolated from fixtures.
- [ ] Forge app has a real registered `app.id` rather than the pre-registration sentinel.
- [ ] Authenticated `forge lint` is green.
- [ ] Development deploy succeeds.
- [ ] Jira development-site install/upgrade succeeds with the actual requested scopes.
- [ ] Real-environment scan is exercised and manually spot-checked for tenant context, pagination, permissions, KVS behavior, evidence provenance and savings correctness.
- [ ] No unresolved BLOCKER/HIGH release finding remains.
- [ ] Marketplace listing/package information accurately describes supported products and known limitations.

## Human / partner evidence — never fabricate

The following values are human-owned and protected from OpenCode agents in `state/human_release_attestations.json`:

- [ ] Atlassian Marketplace partner identity verification is complete where required.
- [ ] At least one real security contact is configured and able to receive Atlassian Marketplace Security tickets.
- [ ] A public privacy-policy URL exists and accurately describes Atlas data handling.
- [ ] The Marketplace Privacy & Security tab has been completed accurately.
- [ ] Applicable Marketplace partner/developer terms have been reviewed/accepted by the responsible human/vendor.

If any item above is missing, Atlas remains unfinished. The factory keeps working on every technical/offline task that remains possible and re-checks external prerequisites on subsequent cycles.

## Atlas V1 data-handling facts to preserve in Marketplace answers

These are implementation facts, not legal conclusions:

- Production transport uses Forge/Atlassian APIs; fixture transport is unreachable from production entrypoints by construction and static gate.
- The current manifest declares no external egress remote for V1.
- Persistent product state uses Forge KVS through a tenant-scoped storage wrapper.
- Storage keys are namespaced from server-resolved installation identity.
- Scan orchestration stores compact cursors, derived/sharded acquisition rows, scan/report state and renewal configuration rather than an external copy of raw Atlassian API payloads.
- Logging has explicit PII/secret scrubbing tests and static secret scanning.
- Organization-admin enrichment is disabled in the production composition root unless explicitly reviewed and enabled later.

Before publishing any privacy statement, re-audit the exact release candidate. Do not copy this section verbatim into a legal privacy policy without confirming the release implementation and completing the human/legal fields.

## Current official Atlassian references checked 2026-08-26

- Forge Marketplace listing: https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
- App approval guidelines: https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/
- Cloud app security requirements: https://developer.atlassian.com/platform/marketplace/security-requirements/
- Marketplace partner security questionnaire: https://developer.atlassian.com/platform/marketplace/partner-security-questionnaire/
- Data privacy guidelines: https://developer.atlassian.com/platform/marketplace/data-privacy-guidelines/

These external requirements can change; the API/security architect must verify them again immediately before submission.
