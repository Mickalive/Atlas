# GitHub configuration for real Atlassian tests

## Required for Forge registration / lint / deploy

Add these GitHub Actions secrets:

- `FORGE_EMAIL` — email of the Atlassian developer account used by Forge CLI.
- `FORGE_API_TOKEN` — Atlassian **API token** for that account. Forge officially supports `FORGE_EMAIL` and `FORGE_API_TOKEN` environment variables in headless CI.

Also provide:

- `FORGE_DEVELOPER_SPACE_ID` — Developer Space ID where the app must be registered. It is not intrinsically secret, but storing it as an Actions secret keeps configuration simple. Every new Forge app must belong to a Developer Space.

## Required to install the development build on a real site

- `ATLASSIAN_SITE` — for example `your-test-site.atlassian.net`. This is configuration rather than a credential, but the workflow reads it from Actions secrets for simplicity.

The Forge account used above must have the rights needed to deploy and install on that test site.

## Required only for live Organization Admin API smoke tests

- `ATLASSIAN_ORG_ID` — the Atlassian Organization ID.
- `ATLASSIAN_ORG_API_KEY` — an Organization API key created by an organization admin, preferably scoped to the minimum read-only admin scopes needed by the tested endpoints.

Important: this Organization API key is **not** the same thing as `FORGE_API_TOKEN`.

The current Organizations REST API documents API-key Bearer authentication for org-wide admin data such as users and product last-active dates. The factory must treat this credential as test-only unless the API feasibility lane establishes a Marketplace-compliant production authentication path. Atlas must not quietly require customers to paste powerful organization credentials without explicitly evaluating the trust/security/distribution consequences.

## Not required

- No OpenAI key.
- No Anthropic key.
- No OpenCode paid-provider key for the current factory: it uses `opencode/x-preview-f-free`, matching the proven free setup used in SPIDER.

## Minimal setup order

1. `FORGE_EMAIL`
2. `FORGE_API_TOKEN`
3. `FORGE_DEVELOPER_SPACE_ID`
4. `ATLASSIAN_SITE`
5. `ATLASSIAN_ORG_ID` + `ATLASSIAN_ORG_API_KEY` if you want the org-wide live-data smoke test immediately.
