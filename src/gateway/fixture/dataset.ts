/**
 * Deterministic fixture dataset for the parity/demo transport.
 *
 * HARD RULES (PRODUCT_V1.md §6, docs/FORGE_PARITY_MODE.md):
 *  - Synthetic identities only (accountId prefix `fixture-`), tenant
 *    "ATLAS PARITY DEMO". Nothing here may resemble real tenant data.
 *  - This file lives ONLY under src/gateway/fixture/; engine modules must not
 *    contain any reference to it (enforced by static gates).
 *  - The gateway routes these responses through the SAME adapters and the SAME
 *    downstream pipeline as production.
 *
 * Scenario coverage map (FORGE_PARITY_MODE §Required fixtures):
 *   active / 30-60-90-180d inactive / never-active / admin-like /
 *   service-account heuristic / explicit exemption / deactivated /
 *   single-group seat / multi-group redundancy / Jira-only vs Confluence-only
 *   evidence / JSM agent-like / JPD creator-like (UNKNOWN seats) / missing &
 *   malformed activity / recently created / duplicate identity / org-enriched
 *   variant / insufficient permissions / pagination incl. mid-loop size change /
 *   429 recovery / partial stream failure / truncated pagination / empty tenant.
 */

export const FIXTURE_TENANT_NAME = 'ATLAS PARITY DEMO';
export const FIXTURE_SCAN_NOW = '2026-08-26T12:00:00.000Z';

function daysAgoIso(days: number): string {
  return new Date(Date.parse(FIXTURE_SCAN_NOW) - days * 86_400_000).toISOString();
}

export type FixtureVariant =
  | 'default'
  | 'insufficient_permissions'
  | 'rate_limit_recovery'
  | 'partial_failure'
  | 'truncated_pagination'
  | 'org_enriched'
  | 'empty_tenant';

export interface FixtureUserSpec {
  accountId: string;
  displayName: string;
  emailHint: string | null;
  active: boolean;
  accountType: string | null;
  createdDaysAgo: number | null;
  jiraGroups: string[];
  confluenceGroups: string[];
  /** Issue hits generated for this user as creator/reporter/assignee. */
  issueAuthorDaysAgo?: number;
  issueAssigneeDaysAgo?: number;
  /** Confluence contribution recency. */
  contributionDaysAgo?: number;
}

const U = (
  accountId: string,
  displayName: string,
  localPart: string,
  createdDaysAgo: number | null,
  jiraGroups: string[],
  confluenceGroups: string[],
  extra: Partial<FixtureUserSpec> = {},
): FixtureUserSpec => ({
  accountId,
  displayName,
  emailHint: `${localPart}@paritydemo.example`,
  active: true,
  accountType: null,
  createdDaysAgo,
  jiraGroups,
  confluenceGroups,
  ...extra,
});

export const GROUPS: Array<{ id: string; name: string }> = [
  { id: 'fixture-group-jira-users', name: 'Jira Software Users' },
  { id: 'fixture-group-jira-second', name: 'Second Jira Path' },
  { id: 'fixture-group-jsm-agents', name: 'Service Desk Agents' },
  { id: 'fixture-group-site-admins-custom', name: 'Site Administrators Custom' },
  { id: 'fixture-group-confluence-users', name: 'Confluence Users' },
];

/** Application roles resolved from the role resource — never hard-coded group names. */
export const APPLICATION_ROLES = [
  {
    key: 'jira-software',
    name: 'Jira Software',
    groups: ['fixture-group-jira-users', 'fixture-group-jira-second'],
    userCount: 14,
    numberOfSeats: 20,
    remainingSeats: 6,
    hasUnlimitedSeats: false,
  },
  {
    key: 'jira-servicedesk',
    name: 'Jira Service Management',
    groups: ['fixture-group-jsm-agents'],
    userCount: 2,
    numberOfSeats: 3,
    remainingSeats: 1,
    hasUnlimitedSeats: false,
  },
  {
    key: 'jira-product-discovery',
    name: 'Jira Product Discovery',
    groups: [],
    userCount: null,
    numberOfSeats: null,
    remainingSeats: null,
    hasUnlimitedSeats: null,
  },
];

export const INSTANCE_LICENSE = {
  applications: [
    { id: 'jira-software', plan: 'PAID' },
    { id: 'jira-servicedesk', plan: 'PAID' },
    { id: 'jira-product-discovery', plan: 'PAID' },
  ],
};

/** Approximate license metrics (7-day cache semantics). JPD total unknown on purpose. */
export const APPROXIMATE_COUNTS: Record<string, number | null> = {
  jira: 20,
  'jira-servicedesk': 3,
  'jira-product-discovery': null,
};

export const USERS: FixtureUserSpec[] = [
  U('fixture-account-active', 'Ada Active', 'ada.active', 900, ['fixture-group-jira-users'], ['fixture-group-confluence-users'], {
    issueAuthorDaysAgo: 5,
    contributionDaysAgo: 12,
  }),
  U('fixture-account-in30', 'Bob Thirty', 'bob.thirty', 900, ['fixture-group-jira-users'], ['fixture-group-confluence-users'], {
    issueAuthorDaysAgo: 30,
    contributionDaysAgo: 45,
  }),
  U('fixture-account-in60', 'Cara Sixty', 'cara.sixty', 900, ['fixture-group-jira-users'], ['fixture-group-confluence-users'], {
    issueAssigneeDaysAgo: 60,
  }),
  U('fixture-account-in95', 'Dan NinetyFive', 'dan.ninetyfive', 900, ['fixture-group-jira-users'], [], {
    issueAuthorDaysAgo: 95,
  }),
  // SAFE_NOW showcase: two independently stale surfaces, full window, non-protected.
  // Positively stale on BOTH surfaces INSIDE the covered window (>=90d, <180d):
  // this is what two independent corroboration surfaces look like in practice.
  U('fixture-account-stale180', 'Eve StaleEverywhere', 'eve.stale', 1200, ['fixture-group-jira-users'], ['fixture-group-confluence-users'], {
    issueAuthorDaysAgo: 100,
    contributionDaysAgo: 120,
  }),
  // Never observed anywhere; account predates the window; both sweeps drain.
  U('fixture-account-neveractive', 'Finn FullSweep', 'finn.fullsweep', 2200, ['fixture-group-jira-users'], ['fixture-group-confluence-users']),
  U('fixture-account-recentcreated', 'Grace NewlyCreated', 'grace.new', 60, ['fixture-group-jira-users'], []),
  // Malformed payload case (ERR-6): hit exists with unusable timestamps.
  U('fixture-account-malformed', 'Heidi MalformedPayload', 'heidi.malformed', 900, ['fixture-group-jira-users'], []),
  U('fixture-account-adminlike', 'Ivan AdminLike', 'ivan.admin', 2600, ['fixture-group-jira-users', 'fixture-group-site-admins-custom'], [], {
    issueAuthorDaysAgo: 300,
  }),
  // Service-account heuristics (email marker + platform app type).
  {
    accountId: 'fixture-account-servicebot',
    displayName: 'CI Integrations Bot',
    emailHint: 'ci-bot@paritydemo.example',
    active: true,
    accountType: 'app',
    createdDaysAgo: 1500,
    jiraGroups: ['fixture-group-jira-users'],
    confluenceGroups: [],
  },
  U('fixture-account-exempted', 'Ken ExplicitExempt', 'ken.exempt', 1400, ['fixture-group-jira-users'], [], {
    issueAuthorDaysAgo: 250,
  }),
  {
    accountId: 'fixture-account-deactivated',
    displayName: 'Lena Deactivated',
    emailHint: 'lena.gone@paritydemo.example',
    active: false,
    accountType: null,
    createdDaysAgo: 1000,
    jiraGroups: ['fixture-group-jira-users'],
    confluenceGroups: [],
  },
  // Redundant access via two groups mapping the same role (money counted once).
  U('fixture-account-multigroup', 'Omar TwoPaths', 'omar.twopaths', 1100, ['fixture-group-jira-users', 'fixture-group-jira-second'], [], {
    issueAuthorDaysAgo: 100,
  }),
  // Recent activity in one product while holding both seats (cross-product conflict).
  U('fixture-account-conflict', 'Petra CrossProduct', 'petra.cross', 900, ['fixture-group-jira-users'], ['fixture-group-confluence-users'], {
    issueAuthorDaysAgo: 400,
    contributionDaysAgo: 20,
  }),
  // Stale positive on one surface + drained absence sweep on the other.
  U('fixture-account-mixedsurfaces', 'Quinn MixedSurfaces', 'quinn.mixed', 2300, ['fixture-group-jira-users'], ['fixture-group-confluence-users'], {
    issueAuthorDaysAgo: 150,
  }),
  // JSM agent-like case.
  U('fixture-account-jsm-agent', 'Rita AgentSeat', 'rita.agent', 1900, ['fixture-group-jsm-agents', 'fixture-group-jira-users'], [], {
    issueAssigneeDaysAgo: 130,
    issueAuthorDaysAgo: 135,
  }),
  // JPD creator-like case: ideas are issues; JPD contributor seats stay UNKNOWN.
  U('fixture-account-jpd-creator', 'Sam IdeaCreator', 'sam.creator', 800, [], ['fixture-group-confluence-users'], {
    issueAuthorDaysAgo: 40,
  }),
  // Org-enrichment showcase (org_enriched variant): no product-REST signals at all.
  U('fixture-account-orginactive', 'Tina OrgInactive', 'tina.orginactive', 1600, ['fixture-group-jira-users'], []),
];

/** Duplicate record to prove canonical identity dedupe (FP-26). */
export const DUPLICATE_ACCOUNT_IDS = new Set(['fixture-account-malformed']);

export function usersFor(variant: FixtureVariant): FixtureUserSpec[] {
  if (variant === 'empty_tenant') return [];
  return USERS;
}

/** Site-wide issue activity hits (creator/reporter/assignee), sorted deterministically. */
export interface FixtureIssueHit {
  key: string;
  updatedDaysAgo: number | null;
  createdDaysAgo: number;
  creator: string | null;
  assignee: string | null;
  reporter: string | null;
  malformedTimestamps?: boolean;
}

let counter = 0;
function nextIssueKey(): string {
  counter += 1;
  return `DEMO-${String(counter).padStart(4, '0')}`;
}

export function issueHitsFor(variant: FixtureVariant): FixtureIssueHit[] {
  counter = 0;
  if (variant === 'empty_tenant') return [];
  const hits: FixtureIssueHit[] = [];
  for (const u of USERS) {
    if (u.issueAuthorDaysAgo !== undefined) {
      hits.push({
        key: nextIssueKey(),
        updatedDaysAgo: u.issueAuthorDaysAgo,
        createdDaysAgo: u.issueAuthorDaysAgo,
        creator: u.accountId,
        assignee: null,
        reporter: u.accountId,
      });
    }
    if (u.issueAssigneeDaysAgo !== undefined && u.issueAssigneeDaysAgo !== u.issueAuthorDaysAgo) {
      hits.push({
        key: nextIssueKey(),
        updatedDaysAgo: u.issueAssigneeDaysAgo,
        createdDaysAgo: u.issueAssigneeDaysAgo + 10,
        creator: 'fixture-account-active',
        assignee: u.accountId,
        reporter: 'fixture-account-active',
      });
    }
  }
  // Malformed hit: identity present, timestamps garbage (ERR-6 preservation).
  hits.push({
    key: nextIssueKey(),
    updatedDaysAgo: null,
    createdDaysAgo: Number.NaN,
    creator: 'fixture-account-malformed',
    assignee: null,
    reporter: null,
    malformedTimestamps: true,
  });
  // JPD idea authored by Sam (product discovery project).
  hits.push({
    key: 'PDV-1001',
    updatedDaysAgo: 40,
    createdDaysAgo: 41,
    creator: 'fixture-account-jpd-creator',
    assignee: null,
    reporter: 'fixture-account-jpd-creator',
  });
  return hits.sort((a, b) => a.key.localeCompare(b.key));
}

/** Accounts with Confluence contributions and their most recent recency. */
export function contributionsFor(variant: FixtureVariant): Map<string, number> {
  const map = new Map<string, number>();
  if (variant === 'empty_tenant') return map;
  for (const u of USERS) {
    if (u.contributionDaysAgo !== undefined) map.set(u.accountId, u.contributionDaysAgo);
  }
  return map;
}

/** Organization enrichment data (org_enriched variant only). */
export function orgUsersFor(variant: FixtureVariant): Array<{
  accountId: string;
  accessBillable: boolean;
  lastActiveDaysAgo: number | null;
  productAccess: Array<{ productId: string; lastActiveDaysAgo: number | null; accessBillable: boolean }>;
  addedToOrgDaysAgo: number | null;
}> {
  if (variant !== 'org_enriched') return [];
  return [
    {
      accountId: 'fixture-account-orginactive',
      accessBillable: true,
      lastActiveDaysAgo: 120,
      productAccess: [{ productId: 'jira-software', lastActiveDaysAgo: 120, accessBillable: true }],
      addedToOrgDaysAgo: 1600,
    },
    {
      accountId: 'fixture-account-active',
      accessBillable: true,
      lastActiveDaysAgo: 1,
      productAccess: [{ productId: 'jira-software', lastActiveDaysAgo: 1, accessBillable: true }],
      addedToOrgDaysAgo: 900,
    },
  ];
}

/** Explicit admin-managed exception list persisted per tenant (FP-10). */
export const FIXTURE_EXCEPTION_ACCOUNTS = ['fixture-account-exempted'];
