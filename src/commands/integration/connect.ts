import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import {
  requireWorkspace,
  getArgString,
  getArgBoolean,
  promptChoice,
  parseJsonArg,
  canWaitForBrowser,
  waitForBrowserCompletion,
  cliConnectUrl,
  runSteps,
  textStep,
  choiceStep,
  secretStep,
  SKIPPED,
  type WizardStep,
} from '../helpers';
import type { Integration } from '../../generated/types';
import { isApiError } from '../../errors/api';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';
import {
  BACK,
  cancel,
  note,
  outro,
  promptConfirmOrBack,
  promptSelectOrBack,
  promptPasswordOrBack,
  promptTextOrBack,
} from '../../utils/prompt';
import { printSlackChannelsLater, runSlackChannelStep } from './slack-channels';

type ConnectBody = Parameters<PolylaneAPI['integrationsConnect']>[0];

type ConnectableType =
  | 'github'
  | 'slack'
  | 'sentry'
  | 'datadog'
  | 'honeycomb'
  | 'axiom'
  | 'betterstack'
  | 'devin'
  | 'cursor'
  | 'factory'
  | 'conductor'
  | 'linear'
  | 'mcp';

// Mirrors each type's subcategory in the integrations catalog
// (`polylane integration catalog`), so callers like the install script can
// narrow the picker to one family of integrations.
export const CONNECT_CATEGORIES = ['git', 'communication', 'observability', 'code-agent', 'issue-tracking', 'protocol'] as const;
type ConnectCategory = (typeof CONNECT_CATEGORIES)[number];

const TYPE_OPTIONS: Array<{ value: ConnectableType; label: string; hint: string; category: ConnectCategory }> = [
  { value: 'github', label: 'GitHub', hint: 'install the GitHub App (browser)', category: 'git' },
  { value: 'slack', label: 'Slack', hint: 'install the Slack app (browser)', category: 'communication' },
  { value: 'sentry', label: 'Sentry', hint: 'install the Sentry integration (browser)', category: 'observability' },
  { value: 'datadog', label: 'Datadog', hint: 'API + application keys', category: 'observability' },
  { value: 'honeycomb', label: 'Honeycomb', hint: 'configuration API key', category: 'observability' },
  { value: 'axiom', label: 'Axiom', hint: 'API token', category: 'observability' },
  { value: 'betterstack', label: 'Better Stack', hint: 'global, Uptime and Telemetry tokens', category: 'observability' },
  { value: 'devin', label: 'Devin', hint: 'API key · coding agent', category: 'code-agent' },
  { value: 'cursor', label: 'Cursor', hint: 'API key · coding agent', category: 'code-agent' },
  { value: 'factory', label: 'Factory', hint: 'API key · coding agent', category: 'code-agent' },
  { value: 'conductor', label: 'Conductor', hint: 'API key · coding agent', category: 'code-agent' },
  { value: 'linear', label: 'Linear', hint: 'personal API key · issue tracking', category: 'issue-tracking' },
  { value: 'mcp', label: 'MCP server', hint: 'any MCP server by URL', category: 'protocol' },
];

export function typeOptionsForCategory(category: string | undefined): typeof TYPE_OPTIONS {
  if (category === undefined) return TYPE_OPTIONS;
  if (!(CONNECT_CATEGORIES as readonly string[]).includes(category)) {
    throw new CLIError(
      `Unknown category: "${category}"`,
      ExitCode.USAGE,
      `Supported categories: ${CONNECT_CATEGORIES.join(', ')}`
    );
  }
  return TYPE_OPTIONS.filter((o) => o.category === category);
}

// The code-agent picker opens with an opt-in question because connecting one
// changes where autofixes run; --type means the user already decided.
export function shouldOfferCodeAgent(
  category: string | undefined,
  typeFromFlag: boolean,
  interactive: boolean
): boolean {
  return category === 'code-agent' && !typeFromFlag && interactive;
}

// The category is validated even when --type wins, so a typo always errors
// instead of being silently ignored.
export function resolveTypeOptions(category: string | undefined, typeFromFlag: boolean): typeof TYPE_OPTIONS {
  const filtered = typeOptionsForCategory(category);
  return typeFromFlag ? TYPE_OPTIONS : filtered;
}

// When the user's primary local agent (config.agent, persisted by `polylane
// setup`) also exists as a cloud code agent, surface it first in its category
// and pre-highlight it in the picker. Exact id match only — the local
// registry and the integration types share ids where they overlap (cursor).
export function prioritizeCodeAgent(
  options: typeof TYPE_OPTIONS,
  localAgent: string | undefined
): { options: typeof TYPE_OPTIONS; initialValue: ConnectableType | undefined } {
  const idx = options.findIndex((o) => o.category === 'code-agent' && o.value === localAgent);
  if (idx < 0) return { options, initialValue: undefined };
  const first = options.findIndex((o) => o.category === 'code-agent');
  const reordered = [...options];
  const [own] = reordered.splice(idx, 1);
  reordered.splice(first, 0, { ...own!, hint: own!.hint.replace(/coding agent$/, 'your coding agent') });
  return { options: reordered, initialValue: own!.value };
}

// Same site list the console offers; the flag accepts any value so orgs on
// sites not listed here (e.g. newer regions) are not locked out.
const DATADOG_SITES = [
  { value: 'datadoghq.com', label: 'US1 (datadoghq.com)' },
  { value: 'us3.datadoghq.com', label: 'US3 (us3.datadoghq.com)' },
  { value: 'us5.datadoghq.com', label: 'US5 (us5.datadoghq.com)' },
  { value: 'datadoghq.eu', label: 'EU (datadoghq.eu)' },
  { value: 'ap1.datadoghq.com', label: 'AP1 (ap1.datadoghq.com)' },
  { value: 'ddog-gov.com', label: 'US1-FED (ddog-gov.com)' },
];

// Datadog's console host only carries the app. prefix on the three original
// sites; regional sites (us3, us5, ap1, ...) are served from the bare host.
// https://docs.datadoghq.com/getting_started/site/
function datadogConsoleUrl(site: string): string {
  const appPrefixed = site === 'datadoghq.com' || site === 'datadoghq.eu' || site === 'ddog-gov.com';
  return appPrefixed ? `https://app.${site}` : `https://${site}`;
}

// The backend detects the Axiom edge deployment region from the API token and
// answers 422 when it cannot; --region is only an explicit override.
type AxiomRegion = 'us-east-1' | 'eu-central-1';

const AXIOM_REGIONS: Array<{ value: AxiomRegion; label: string }> = [
  { value: 'us-east-1', label: 'US East 1' },
  { value: 'eu-central-1', label: 'EU Central 1' },
];

const AXIOM_REGION_HINT = 'In Axiom: Settings > General > Edge deployment (https://app.axiom.co/settings/general)';

export async function connectAxiom(
  config: Config,
  api: PolylaneAPI,
  body: Extract<ConnectBody, { type: 'axiom' }>
): Promise<typeof BACK | Integration> {
  try {
    return await api.integrationsConnect(body);
  } catch (err) {
    if (!isApiError(err) || err.status !== 422 || body.region !== undefined) throw err;
    if (!isInteractive(config.nonInteractive)) {
      throw new CLIError(
        err.message,
        ExitCode.USAGE,
        `Pass --region us-east-1 or --region eu-central-1.\n${AXIOM_REGION_HINT}`
      );
    }
    note(`${err.message}\n${AXIOM_REGION_HINT}`, 'Axiom region');
    const picked = await promptSelectOrBack<AxiomRegion>(
      { nonInteractive: config.nonInteractive },
      'Axiom edge deployment region',
      AXIOM_REGIONS
    );
    if (picked === BACK) return BACK;
    return api.integrationsConnect({ ...body, region: picked });
  }
}

const CODE_AGENTS = {
  devin: {
    name: 'Devin',
    instructions:
      'In Devin, go to Settings > Service users, create a service user and generate its API key. Create it inside the organization, not in Enterprise settings (an enterprise-scoped key is rejected). Give it the Member role; on a custom enterprise role select ManageOrgSessions, ViewOrgSessions and UseDevinSessions. The key starts with cog_ and is shown only once.',
    link: 'https://app.devin.ai/settings/devin-api?tab=service-users',
    linkLabel: 'Create service user',
  },
  cursor: {
    name: 'Cursor',
    instructions:
      'Create a user API key under Dashboard > API Keys. Pick a user key, not a service account key (service account keys are rejected). There are no scopes to select. Keys start with crsr_ (older ones with key_). Your target repositories must be connected to Cursor\'s GitHub App.',
    link: 'https://cursor.com/dashboard/api',
    linkLabel: 'Open Cursor API keys',
  },
  factory: {
    name: 'Factory',
    instructions:
      'Create an API key in your Factory settings. Prefer a service account key (org-owned; creating one needs the Owner or Manager role). Factory keys have no scope options. The key starts with fk- and is shown only once.',
    link: 'https://app.factory.ai/settings/api-keys',
    linkLabel: 'Create API key',
  },
  conductor: {
    name: 'Conductor',
    instructions:
      'Create an API key in Conductor under Users > API keys. The key starts with sk_. Handed-off autofixes run as agents in Conductor Cloud workspaces on your account.',
    link: 'https://app.conductor.build/users/api-keys',
    linkLabel: 'Create API key',
  },
} as const;

function isCodeAgentType(value: Integration['type']): value is keyof typeof CODE_AGENTS {
  return value in CODE_AGENTS;
}

// A completed handoff is only counted as connected when the integration
// actually showed up — a timed-out wait must not look like a success to
// callers or exit codes.
export type ConnectOutcome = 'connected' | 'timeout';

export interface IntegrationBaseline {
  existing: Integration[];
  check: () => Promise<Integration | null>;
}

// Baseline the integrations of one type: what already exists (for the
// already-connected short-circuit) plus a poller that spots the one the
// browser flow creates — or updates, when it's a re-install.
export async function integrationBaseline(
  api: PolylaneAPI,
  workspaceId: string,
  type: string
): Promise<IntegrationBaseline> {
  const before = await api.integrationsList(workspaceId, { type, perPage: 100 });
  const seen = new Map(before.items.map((i) => [i.id, i.updated ?? '']));
  const check = async (): Promise<Integration | null> => {
    const current = await api.integrationsList(workspaceId, { type, perPage: 100 });
    return current.items.find((i) => !seen.has(i.id) || seen.get(i.id) !== (i.updated ?? '')) ?? null;
  };
  return { existing: before.items, check };
}

function printAlreadyConnected(config: Config, name: string, integration: Integration): void {
  if (config.output === 'json') {
    formatOutput(config, integration);
    return;
  }
  const detail = integration.name && integration.name !== name ? `: ${integration.name}` : '';
  process.stderr.write(`✓ ${name} is already connected${detail}\n`);
  if (!config.quiet) {
    process.stderr.write('Re-run with --reconnect to go through the connect flow again.\n');
  }
}

async function confirmBrowserConnect(
  config: Config,
  check: (() => Promise<Integration | null>) | null,
  label: string
): Promise<ConnectOutcome> {
  if (!check) {
    if (!config.quiet && config.output !== 'json') {
      process.stderr.write('\nAfter finishing in the browser, check with `polylane integration list`.\n');
    }
    return 'connected';
  }
  const found = await waitForBrowserCompletion(config, check, {
    waitingFor: `${label} to connect`,
    interruptHint: 'Check with `polylane integration list`.',
  });
  if (found) {
    process.stderr.write(`✓ ${label} connected: ${found.name}\n`);
    return 'connected';
  }
  process.stderr.write('Timed out waiting — the connection has not shown up yet. Check with `polylane integration list`.\n');
  return 'timeout';
}

function printConnectSuccess(config: Config, integration: Integration, label: string): void {
  if (config.output === 'json') {
    formatOutput(config, integration);
    return;
  }
  const detail = integration.name && integration.name !== label ? `: ${integration.name}` : '';
  process.stderr.write(`✓ ${label} connected${detail}\n`);
}

async function openOrPrintInstallUrl(config: Config, url: string, label: string, noBrowser: boolean): Promise<void> {
  if (config.output === 'json') {
    formatOutput(config, { url });
    return;
  }
  const shouldOpen = !noBrowser && isInteractive(config.nonInteractive);
  if (shouldOpen) {
    if (!config.quiet) {
      process.stderr.write(`Opening ${label} install page in your browser…\n`);
      process.stderr.write("If it doesn't open, use this URL:\n");
    }
    process.stdout.write(url + '\n');
    openBrowser(url);
  } else {
    if (!config.quiet) {
      process.stderr.write(`Open this URL to install ${label}:\n`);
    }
    process.stdout.write(url + '\n');
  }
}

// --- MCP: direct connect or OAuth ---
async function connectMcp(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string,
  noBrowser: boolean
): Promise<typeof BACK | ConnectOutcome> {
  const ctx = { nonInteractive: config.nonInteractive };
  let url = '';
  let name = '';
  let authMethod = 'none' as 'none' | 'bearer' | 'oauth';
  let bearerToken = getArgString(args, 'bearerToken');
  const ok = await runSteps([
    textStep(config, args, 'url', 'MCP server URL', '--url', (v) => {
      url = v;
    }),
    textStep(config, args, 'name', 'Display name', '--name', (v) => {
      name = v;
    }),
    async () => {
      if (getArgBoolean(args, 'oauth') === true) {
        authMethod = 'oauth';
        return SKIPPED;
      }
      if (bearerToken !== undefined) {
        authMethod = 'bearer';
        return SKIPPED;
      }
      if (!isInteractive(config.nonInteractive)) {
        authMethod = 'none';
        return SKIPPED;
      }
      const picked = await promptSelectOrBack<'none' | 'bearer' | 'oauth'>(ctx, 'Authentication', [
        { value: 'none', label: 'No authentication', hint: 'Public server' },
        { value: 'bearer', label: 'Bearer token', hint: 'API key / token' },
        { value: 'oauth', label: 'OAuth', hint: 'Opens browser to authorize' },
      ]);
      if (picked === BACK) return BACK;
      authMethod = picked;
      return;
    },
    async () => {
      if (authMethod !== 'bearer' || bearerToken !== undefined) return SKIPPED;
      note(
        'Paste the bare token, without the "Bearer " prefix. Polylane adds that.\nGet it from whoever runs this MCP server. MCP defines no standard console or scope names.\nThe token needs whatever the server requires for tools/list and tools/call. Polylane calls nothing else.',
        'Bearer token'
      );
      const token = await promptPasswordOrBack(ctx, 'Bearer token');
      if (token === BACK) return BACK;
      bearerToken = token;
      return;
    },
  ]);
  if (!ok) return BACK;

  const transport = (getArgString(args, 'transport') ?? 'http') as 'http' | 'sse';
  const extraHeadersRaw = getArgString(args, 'extraHeaders');
  const extraHeaders = extraHeadersRaw
    ? (parseJsonArg(extraHeadersRaw, '--extra-headers') as Record<string, string>)
    : undefined;

  if (authMethod === 'oauth') {
    const scope = getArgString(args, 'scope');
    const check = canWaitForBrowser(config) ? (await integrationBaseline(api, workspaceId, 'mcp')).check : null;
    const result = await api.integrationsMcpOauthStart({
      workspaceId,
      url,
      name,
      ...(transport !== 'http' ? { transport } : {}),
      ...(scope ? { scope } : {}),
      ...(extraHeaders ? { extraHeaders } : {}),
    });
    await openOrPrintInstallUrl(config, result.authorizeUrl, 'the MCP server authorization page', noBrowser);
    if (!config.quiet && config.output !== 'json') {
      process.stderr.write(`\nPending integration: ${result.pendingId}\n`);
    }
    return confirmBrowserConnect(config, check, name);
  }

  const integration = await api.integrationsMcpConnect({
    type: 'mcp',
    workspaceId,
    url,
    name,
    ...(transport !== 'http' ? { transport } : {}),
    ...(bearerToken ? { bearerToken } : {}),
    ...(extraHeaders ? { extraHeaders } : {}),
  });
  printConnectSuccess(config, integration, name);
  return 'connected';
}

const MANAGEMENT_KEY_PAIR_HINT = 'Pass both --management-api-key-id and --management-api-key-secret.';

// The API stores the Management API key only as a pair, and both halves are
// required — a missing (or whitespace-only) half is a usage error before any
// request is sent. Both halves are trimmed here so the flag and prompt paths
// behave identically on pasted values.
export function honeycombManagementKeyFields(
  managementApiKeyId: string,
  managementApiKeySecret: string
): { managementApiKeyId: string; managementApiKeySecret: string } {
  const id = managementApiKeyId.trim();
  const secret = managementApiKeySecret.trim();
  if (!id || !secret) {
    const missing = !id ? '--management-api-key-id' : '--management-api-key-secret';
    throw new CLIError(`Missing required flag: ${missing}`, ExitCode.USAGE, MANAGEMENT_KEY_PAIR_HINT);
  }
  return { managementApiKeyId: id, managementApiKeySecret: secret };
}

// Both management-key steps share the same shape: a flag short-circuits, a
// non-interactive run without the flag is a usage error, and only the prompt
// differs.
function managementKeyStep(
  config: Config,
  args: Record<string, unknown>,
  key: 'managementApiKeyId' | 'managementApiKeySecret',
  flag: string,
  prompt: () => Promise<string | typeof BACK>,
  set: (value: string) => void
): WizardStep {
  return async () => {
    const fromFlag = getArgString(args, key);
    if (fromFlag !== undefined) {
      set(fromFlag);
      return SKIPPED;
    }
    if (!isInteractive(config.nonInteractive)) {
      throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE, MANAGEMENT_KEY_PAIR_HINT);
    }
    const value = await prompt();
    if (value === BACK) return BACK;
    set(value);
    return;
  };
}

// An API build that predates the management-key fields strips them from the
// connect body and stores the integration without them. The response echoes
// the stored metadata (the key ID survives redaction), so a missing ID there
// means the key was silently dropped — that must fail loudly, not read as a
// successful connect. The generated metadata type gains managementApiKeyId
// only when the matching API deploy lands, so the field is read through a
// structural cast, same trust boundary as the request-body spread.
export function assertHoneycombManagementKeyStored(
  integration: Pick<Integration, 'id' | 'metadata' | '_html_url'>
): void {
  const metadata = integration.metadata as { managementApiKeyId?: unknown } | null | undefined;
  if (metadata != null && typeof metadata.managementApiKeyId === 'string' && metadata.managementApiKeyId !== '') {
    return;
  }
  throw new CLIError(
    'The Polylane API does not support the Honeycomb Management API key yet — the key was not stored',
    ExitCode.GENERAL,
    'Honeycomb was connected without query access. Disconnect it, then retry once the API is updated:\n' +
      `polylane integration disconnect ${integration.id} --yes` +
      (integration._html_url ? `\nor reconnect from the console: ${integration._html_url}` : '')
  );
}

// --- Credential-based connects: each wizard step can go back to the previous
// one, and backing out of the first returns BACK to re-open type selection ---
async function connectWithCredentials(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string,
  type: Exclude<ConnectableType, 'github' | 'slack' | 'sentry' | 'mcp'>
): Promise<typeof BACK | ConnectOutcome> {
  let body: ConnectBody;
  if (type === 'datadog') {
    let site = '';
    let apiKey = '';
    let appKey = '';
    const ok = await runSteps([
      choiceStep(config, args, 'site', '--site', 'Datadog site: the one in your Datadog URL', DATADOG_SITES, (v) => {
        site = v;
      }),
      secretStep(
        config,
        args,
        'apiKey',
        '--api-key',
        () => ({
          message: 'Datadog API key',
          instructions:
            'Organization Settings > API Keys > New Key. An org-level credential with no permissions to choose. Opaque hex string, no prefix.',
          link: `${datadogConsoleUrl(site)}/organization-settings/api-keys`,
          linkLabel: 'Create API key',
        }),
        (v) => {
          apiKey = v;
        }
      ),
      secretStep(
        config,
        args,
        'appKey',
        '--app-key',
        () => ({
          message: 'Datadog application key',
          instructions:
            'Organization Settings > Application Keys > New Key. Create it as a Datadog Admin (connect reads your org, which needs the org_management permission) and leave it unscoped so it inherits your role. Opaque hex string; on newer orgs it is shown only once.',
          link: `${datadogConsoleUrl(site)}/organization-settings/application-keys`,
          linkLabel: 'Create application key',
        }),
        (v) => {
          appKey = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { type: 'datadog', workspaceId, site, apiKey, appKey };
  } else if (type === 'honeycomb') {
    let region: 'us' | 'eu' = 'us';
    let apiKey = '';
    let managementApiKeyId = '';
    let managementApiKeySecret = '';
    const ok = await runSteps([
      choiceStep<'us' | 'eu'>(
        config,
        args,
        'region',
        '--region',
        'Honeycomb region: the one in your Honeycomb URL',
        [
          { value: 'us', label: 'US (api.honeycomb.io)' },
          { value: 'eu', label: 'EU (api.eu1.honeycomb.io)' },
        ],
        (v) => {
          region = v;
        },
        { strict: true }
      ),
      secretStep(
        config,
        args,
        'apiKey',
        '--api-key',
        () => ({
          message: 'Honeycomb configuration API key',
          instructions:
            'In Honeycomb, go to Environments > Manage Environments, pick your environment, open API Keys, switch to the Configuration tab, and create a key named "polylane" with these permissions: Create Datasets, Manage Queries and Columns, Run Queries, Manage Public Boards, Manage SLOs, Manage Triggers, Manage Recipients, Manage Markers. Leave Send Events and Read Service Maps off. The key is an opaque string with no prefix.',
          link: region === 'eu' ? 'https://ui.eu1.honeycomb.io' : 'https://ui.honeycomb.io',
          linkLabel: 'Open Honeycomb',
        }),
        (v) => {
          apiKey = v;
        }
      ),
      managementKeyStep(
        config,
        args,
        'managementApiKeyId',
        '--management-api-key-id',
        () => {
          note('Create one in your Honeycomb team settings under API Keys.', 'Management API key');
          return promptTextOrBack({ nonInteractive: config.nonInteractive }, 'Management API key ID', {
            validate: (v: string) => (v.trim() ? undefined : 'Required'),
          });
        },
        (v) => {
          managementApiKeyId = v;
        }
      ),
      managementKeyStep(
        config,
        args,
        'managementApiKeySecret',
        '--management-api-key-secret',
        () => promptPasswordOrBack({ nonInteractive: config.nonInteractive }, 'Management API key secret'),
        (v) => {
          managementApiKeySecret = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    // Spread instead of literal fields: the client is generated from the live
    // prod spec, which gains these two fields only when the matching API
    // deploy lands. The spread keeps typecheck green on both sides; the old
    // API strips unknown keys (caught after connect by
    // assertHoneycombManagementKeyStored), the new one validates them.
    body = {
      type: 'honeycomb',
      workspaceId,
      region,
      apiKey,
      ...honeycombManagementKeyFields(managementApiKeyId, managementApiKeySecret),
    };
  } else if (type === 'axiom') {
    const region = getArgString(args, 'region');
    if (region !== undefined && !AXIOM_REGIONS.some((o) => o.value === region)) {
      throw new CLIError(
        `Invalid value for --region: "${region}"`,
        ExitCode.USAGE,
        `Use one of: ${AXIOM_REGIONS.map((o) => o.value).join(', ')}`
      );
    }
    let apiToken = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'apiToken',
        '--api-token',
        {
          message: 'Axiom API token',
          instructions:
            'In Axiom, go to Settings > API tokens > New API token. Pick Advanced > Custom, select all datasets and grant Query. Org level permissions: Datasets read; Dashboards read; Monitors read and update; Notifiers create, read and delete. The token starts with xaat-.',
          link: 'https://app.axiom.co/settings/api-tokens',
          linkLabel: 'Create API token',
        },
        (v) => {
          apiToken = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { type: 'axiom', workspaceId, apiToken, ...(region !== undefined ? { region: region as AxiomRegion } : {}) };
  } else if (type === 'betterstack') {
    let apiToken = '';
    let uptimeApiToken = '';
    let telemetryApiToken = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'apiToken',
        '--api-token',
        {
          message: 'Better Stack global API token',
          instructions:
            'In Better Stack, open API tokens and create a token in the Global API tokens section. It is valid across all your teams; Better Stack tokens have no scope options.',
          link: 'https://betterstack.com/settings/global-api-tokens',
          linkLabel: 'Create global API token',
        },
        (v) => {
          apiToken = v;
        }
      ),
      secretStep(
        config,
        args,
        'uptimeApiToken',
        '--uptime-api-token',
        {
          message: 'Better Stack Uptime API token',
          instructions:
            'On the API tokens page, switch to Team-based tokens, select the team that owns your monitors, and copy its Uptime API token. No scopes to pick; the token can create monitors and webhooks in that team.',
          link: 'https://betterstack.com/settings/api-tokens/0',
          linkLabel: 'Open team API tokens',
        },
        (v) => {
          uptimeApiToken = v;
        }
      ),
      secretStep(
        config,
        args,
        'telemetryApiToken',
        '--telemetry-api-token',
        {
          message: 'Better Stack Telemetry API token',
          instructions:
            'Same page: API tokens > Team-based tokens, same team as above. Copy the token from the Telemetry API tokens section. This is not a source ingest token.',
          link: 'https://betterstack.com/settings/api-tokens/0',
          linkLabel: 'Open team API tokens',
        },
        (v) => {
          telemetryApiToken = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { type: 'betterstack', workspaceId, apiToken, uptimeApiToken, telemetryApiToken };
  } else if (type === 'linear') {
    let apiKey = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'apiKey',
        '--api-key',
        {
          message: 'Linear API key',
          instructions:
            'In Linear, open Settings > Security & access and create a key under Personal API keys. It needs write access so agents can create and update issues; issue writes still ask for confirmation before they execute. The key starts with lin_api_ and is shown only once.',
          link: 'https://linear.app/settings/account/security',
          linkLabel: 'Open Linear settings',
        },
        (v) => {
          apiKey = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { type: 'linear', workspaceId, apiKey };
  } else {
    const agent = CODE_AGENTS[type];
    let apiKey = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'apiKey',
        '--api-key',
        {
          message: `${agent.name} API key`,
          instructions: agent.instructions,
          link: agent.link,
          linkLabel: agent.linkLabel,
        },
        (v) => {
          apiKey = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { type, workspaceId, apiKey };
  }

  const integration = body.type === 'axiom' ? await connectAxiom(config, api, body) : await api.integrationsConnect(body);
  if (integration === BACK) return BACK;
  if (type === 'honeycomb') assertHoneycombManagementKeyStored(integration);
  printConnectSuccess(config, integration, TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type);
  if (isCodeAgentType(integration.type) && !config.quiet && config.output !== 'json') {
    process.stderr.write(`Connecting ${CODE_AGENTS[integration.type].name} makes it the default autofix executor.\n`);
  }
  return 'connected';
}

async function connectType(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string,
  type: ConnectableType,
  noBrowser: boolean
): Promise<typeof BACK | ConnectOutcome> {
  // --- Install-URL flows: the browser enters via the console's /cli/connect
  // page (which ends the journey on its "go back to your terminal" page),
  // while the CLI waits for the integration to appear. When the type is
  // already connected, succeed without opening a browser — only an explicit
  // --reconnect takes the wait-for-update path ---
  if (type === 'github' || type === 'slack' || type === 'sentry') {
    const labels = { github: 'the GitHub App', slack: 'the Slack app', sentry: 'the Sentry integration' } as const;
    const names = { github: 'GitHub', slack: 'Slack', sentry: 'Sentry' } as const;
    const reconnect = getArgBoolean(args, 'reconnect') === true;
    const baseline = config.dryRun ? null : await integrationBaseline(api, workspaceId, type);
    if (baseline && !reconnect && baseline.existing.length > 0) {
      const existing = baseline.existing[0]!;
      printAlreadyConnected(config, names[type], existing);
      if (type === 'slack') {
        if (canWaitForBrowser(config)) {
          await runSlackChannelStep(config, api, workspaceId, existing.id, { alreadyConnected: true });
        } else {
          printSlackChannelsLater(config);
        }
      }
      return 'connected';
    }
    const check = canWaitForBrowser(config) && baseline ? baseline.check : null;
    await openOrPrintInstallUrl(config, cliConnectUrl(config, type, workspaceId), labels[type], noBrowser);
    const outcome = await confirmBrowserConnect(config, check, names[type]);
    // The channel step needs the new integration's id; the browser wait already spotted the row,
    // so one more check() returns it without another wait.
    if (type === 'slack') {
      if (outcome === 'connected' && check) {
        const created = await check();
        if (created) await runSlackChannelStep(config, api, workspaceId, created.id, { alreadyConnected: false });
      } else if (!check) {
        printSlackChannelsLater(config);
      }
    }
    return outcome;
  }
  if (type === 'mcp') {
    return connectMcp(config, api, args, workspaceId, noBrowser);
  }
  return connectWithCredentials(config, api, args, workspaceId, type);
}

export const integrationConnectCommand: Command = {
  name: 'integration connect',
  description: 'Connect an integration (GitHub, Slack, Sentry, Datadog, Honeycomb, Axiom, Better Stack, Devin, Cursor, Factory, Conductor, Linear, MCP)',
  operationId: 'integrations.connect',
  options: [
    {
      flag: '--type <type>',
      description: `${TYPE_OPTIONS.map((o) => o.value).join(' | ')} (prompted if omitted)`,
      type: 'string',
    },
    {
      flag: '--category <cat>',
      description: `Only offer integrations in this category: ${CONNECT_CATEGORIES.join(' | ')} (--type wins over the filter)`,
      type: 'string',
    },
    { flag: '--site <site>', description: 'Datadog site (e.g. us5.datadoghq.com)', type: 'string' },
    { flag: '--region <region>', description: 'Honeycomb (us|eu) or Axiom (us-east-1|eu-central-1; detected from the token if omitted)', type: 'string' },
    { flag: '--api-key <key>', description: 'API key (Datadog / Honeycomb / Devin / Cursor / Factory / Conductor / Linear)', type: 'string' },
    { flag: '--app-key <key>', description: 'App key (Datadog only)', type: 'string' },
    { flag: '--management-api-key-id <id>', description: 'Management API key ID (Honeycomb)', type: 'string' },
    { flag: '--management-api-key-secret <secret>', description: 'Management API key secret (Honeycomb)', type: 'string' },
    { flag: '--api-token <token>', description: 'API token (Axiom / Better Stack global token)', type: 'string' },
    { flag: '--uptime-api-token <token>', description: 'Uptime API token (Better Stack only)', type: 'string' },
    { flag: '--telemetry-api-token <token>', description: 'Telemetry API token (Better Stack only)', type: 'string' },
    { flag: '--url <url>', description: 'MCP server URL', type: 'string' },
    { flag: '--name <name>', description: 'MCP server display name', type: 'string' },
    { flag: '--transport <t>', description: 'MCP transport: http | sse (default: http)', type: 'string' },
    { flag: '--bearer-token <token>', description: 'MCP bearer token for direct auth', type: 'string' },
    { flag: '--extra-headers <json>', description: 'MCP extra headers as JSON object', type: 'string' },
    { flag: '--oauth', description: 'MCP: use OAuth flow (opens browser to authorize)', type: 'boolean' },
    { flag: '--scope <scope>', description: 'MCP OAuth scope', type: 'string' },
    { flag: '--no-browser', description: 'GitHub / Slack / Sentry / MCP OAuth: print the URL instead of opening it', type: 'boolean' },
    { flag: '--reconnect', description: 'GitHub / Slack / Sentry: run the connect flow even when the integration is already connected', type: 'boolean' },
  ],
  examples: [
    'polylane integration connect',
    'polylane integration connect --type github',
    'polylane integration connect --type github --reconnect',
    'polylane integration connect --category observability',
    'polylane integration connect --category code-agent',
    'polylane integration connect --type datadog --site us5.datadoghq.com --api-key ... --app-key ...',
    'polylane integration connect --type honeycomb --region us --api-key ... --management-api-key-id ... --management-api-key-secret ...',
    'polylane integration connect --type axiom --api-token ...',
    'polylane integration connect --type betterstack --api-token ... --uptime-api-token ... --telemetry-api-token ...',
    'polylane integration connect --type cursor --api-key crsr_...',
    'polylane integration connect --type linear --api-key lin_api_...',
    'polylane integration connect --type mcp --url https://mcp.example.com/sse --name "My MCP"',
    'polylane integration connect --type mcp --url https://mcp.example.com/sse --name "My MCP" --oauth',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const noBrowser = getArgBoolean(args, 'noBrowser') === true;
    const typeFromFlag = getArgString(args, 'type') !== undefined;
    const category = getArgString(args, 'category');
    // --type always wins: the category filter only narrows the picker.
    const { options: typeOptions, initialValue } = prioritizeCodeAgent(
      resolveTypeOptions(category, typeFromFlag),
      config.agent
    );

    if (shouldOfferCodeAgent(category, typeFromFlag, isInteractive(config.nonInteractive))) {
      note(
        'Optional. Polylane runs autofixes on its own executor; connect your coding agent to run them in your account instead.',
        'Cloud coding agent'
      );
      const wants = await promptConfirmOrBack(
        { nonInteractive: config.nonInteractive },
        'Connect a cloud coding agent?',
        true
      );
      if (wants !== true) {
        outro('Skipped. Connect later with `polylane integration connect --category code-agent`.');
        return;
      }
    }

    const workspaceId = await requireWorkspace(config);
    const api = new PolylaneAPI(config);

    // Type selection restarts whenever the user backs out of the first step of
    // the chosen flow, so nothing is committed until a flow completes.
    for (;;) {
      const type =
        typeFromFlag || !isInteractive(config.nonInteractive)
          ? await promptChoice<ConnectableType>(
              config,
              args,
              'type',
              '--type',
              'Which integration do you want to connect?',
              typeOptions,
              { strict: true }
            )
          : await promptSelectOrBack<ConnectableType>(
              { nonInteractive: config.nonInteractive },
              'Which integration do you want to connect?',
              typeOptions,
              'Cancel',
              initialValue
            );
      if (type === BACK) break;
      const outcome = await connectType(config, api, args, workspaceId, type, noBrowser);
      if (outcome !== BACK) {
        if (outcome === 'timeout') process.exitCode = ExitCode.GENERAL;
        return;
      }
      if (typeFromFlag) break;
    }
    cancel('Nothing connected.');
  },
};
