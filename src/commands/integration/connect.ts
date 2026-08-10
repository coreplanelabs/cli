import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import {
  requireWorkspace,
  getArgString,
  getArgBoolean,
  promptIfMissing,
  promptChoice,
  promptSecret,
  parseJsonArg,
  canWaitForBrowser,
  waitForBrowserCompletion,
  cliConnectUrl,
} from '../helpers';
import type { Integration } from '../../generated/types';
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';
import { promptSelect, promptPassword, promptConfirm } from '../../utils/prompt';

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
  | 'mcp';

const TYPE_OPTIONS: Array<{ value: ConnectableType; label: string; hint: string }> = [
  { value: 'github', label: 'GitHub', hint: 'install the GitHub App (browser)' },
  { value: 'slack', label: 'Slack', hint: 'install the Slack app (browser)' },
  { value: 'sentry', label: 'Sentry', hint: 'install the Sentry integration (browser)' },
  { value: 'datadog', label: 'Datadog', hint: 'API + application keys' },
  { value: 'honeycomb', label: 'Honeycomb', hint: 'configuration API key' },
  { value: 'axiom', label: 'Axiom', hint: 'API token' },
  { value: 'betterstack', label: 'Better Stack', hint: 'global, Uptime and Telemetry tokens' },
  { value: 'devin', label: 'Devin', hint: 'API key — coding agent' },
  { value: 'cursor', label: 'Cursor', hint: 'API key — coding agent' },
  { value: 'factory', label: 'Factory', hint: 'API key — coding agent' },
  { value: 'mcp', label: 'MCP server', hint: 'any MCP server by URL' },
];

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

const CODE_AGENTS = {
  devin: {
    name: 'Devin',
    instructions: 'Create a service user and copy its API key (cog_…).',
    link: 'https://app.devin.ai/settings/devin-api?tab=service-users',
    linkLabel: 'Open Devin service users',
  },
  cursor: {
    name: 'Cursor',
    instructions:
      'Create an API key (key_…) under Cursor → Settings. Make sure your target repositories are connected to your Cursor account.',
    link: 'https://cursor.com/dashboard/api?section=user-keys#user-api-keys',
    linkLabel: 'Open Cursor settings',
  },
  factory: {
    name: 'Factory',
    instructions: 'Create an API key (fk-…) in your Factory settings.',
    link: 'https://app.factory.ai/settings/api-keys',
    linkLabel: 'Open Factory settings',
  },
} as const;

// Baseline the integrations of one type so the poller can spot the one the
// browser flow creates — or updates, when it's a re-install.
async function integrationArrivalCheck(
  api: PolylaneAPI,
  workspaceId: string,
  type: string
): Promise<() => Promise<Integration | null>> {
  const before = await api.integrationsList(workspaceId, { type, perPage: 100 });
  const seen = new Map(before.items.map((i) => [i.id, i.updated ?? '']));
  return async () => {
    const current = await api.integrationsList(workspaceId, { type, perPage: 100 });
    return current.items.find((i) => !seen.has(i.id) || seen.get(i.id) !== (i.updated ?? '')) ?? null;
  };
}

async function confirmBrowserConnect(
  config: Config,
  check: (() => Promise<Integration | null>) | null,
  label: string
): Promise<void> {
  if (!check) {
    if (!config.quiet && config.output !== 'json') {
      process.stderr.write('\nAfter finishing in the browser, check with `polylane integration list`.\n');
    }
    return;
  }
  const found = await waitForBrowserCompletion(config, check, {
    waitingFor: `${label} to connect`,
    interruptHint: 'Check with `polylane integration list`.',
  });
  if (found) {
    process.stderr.write(`✓ ${label} connected: ${found.name}\n`);
  } else {
    process.stderr.write('Not seeing the connection yet — check with `polylane integration list`.\n');
  }
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

export const integrationConnectCommand: Command = {
  name: 'integration connect',
  description: 'Connect an integration (GitHub, Slack, Sentry, Datadog, Honeycomb, Axiom, Better Stack, Devin, Cursor, Factory, MCP)',
  operationId: 'integrations.connect',
  options: [
    {
      flag: '--type <type>',
      description: `${TYPE_OPTIONS.map((o) => o.value).join(' | ')} (prompted if omitted)`,
      type: 'string',
    },
    { flag: '--site <site>', description: 'Datadog site (e.g. us5.datadoghq.com)', type: 'string' },
    { flag: '--region <region>', description: 'Honeycomb (us|eu) or Axiom (us-east-1|eu-central-1)', type: 'string' },
    { flag: '--api-key <key>', description: 'API key (Datadog / Honeycomb / Devin / Cursor / Factory)', type: 'string' },
    { flag: '--app-key <key>', description: 'App key (Datadog only)', type: 'string' },
    { flag: '--api-token <token>', description: 'API token (Axiom / Better Stack global token)', type: 'string' },
    { flag: '--uptime-api-token <token>', description: 'Uptime API token (Better Stack only)', type: 'string' },
    { flag: '--telemetry-api-token <token>', description: 'Telemetry API token (Better Stack only)', type: 'string' },
    { flag: '--no-default-executor', description: 'Devin / Cursor / Factory: do not route autofixes through it', type: 'boolean' },
    { flag: '--url <url>', description: 'MCP server URL', type: 'string' },
    { flag: '--name <name>', description: 'MCP server display name', type: 'string' },
    { flag: '--transport <t>', description: 'MCP transport: http | sse (default: http)', type: 'string' },
    { flag: '--bearer-token <token>', description: 'MCP bearer token for direct auth', type: 'string' },
    { flag: '--extra-headers <json>', description: 'MCP extra headers as JSON object', type: 'string' },
    { flag: '--oauth', description: 'MCP: use OAuth flow (opens browser to authorize)', type: 'boolean' },
    { flag: '--scope <scope>', description: 'MCP OAuth scope', type: 'string' },
    { flag: '--no-browser', description: 'GitHub / Slack / Sentry / MCP OAuth: print the URL instead of opening it', type: 'boolean' },
  ],
  examples: [
    'polylane integration connect',
    'polylane integration connect --type github',
    'polylane integration connect --type datadog --site us5.datadoghq.com --api-key ... --app-key ...',
    'polylane integration connect --type honeycomb --region us --api-key ...',
    'polylane integration connect --type axiom --region us-east-1 --api-token ...',
    'polylane integration connect --type betterstack --api-token ... --uptime-api-token ... --telemetry-api-token ...',
    'polylane integration connect --type cursor --api-key key_...',
    'polylane integration connect --type mcp --url https://mcp.example.com/sse --name "My MCP"',
    'polylane integration connect --type mcp --url https://mcp.example.com/sse --name "My MCP" --oauth',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const type = await promptChoice<ConnectableType>(
      config,
      args,
      'type',
      '--type',
      'Which integration do you want to connect?',
      TYPE_OPTIONS,
      { strict: true }
    );
    const noBrowser = getArgBoolean(args, 'noBrowser') === true;
    const api = new PolylaneAPI(config);

    // --- Install-URL flows: the browser enters via the console's /cli/connect
    // page (which ends the journey on its "go back to your terminal" page),
    // while the CLI waits for the integration to appear ---
    if (type === 'github' || type === 'slack' || type === 'sentry') {
      const labels = { github: 'the GitHub App', slack: 'the Slack app', sentry: 'the Sentry integration' } as const;
      const names = { github: 'GitHub', slack: 'Slack', sentry: 'Sentry' } as const;
      const check = canWaitForBrowser(config) ? await integrationArrivalCheck(api, workspaceId, type) : null;
      await openOrPrintInstallUrl(config, cliConnectUrl(config, type, workspaceId), labels[type], noBrowser);
      await confirmBrowserConnect(config, check, names[type]);
      return;
    }

    // --- MCP: direct connect or OAuth ---
    if (type === 'mcp') {
      const url = await promptIfMissing(config, args, 'url', 'MCP server URL', '--url');
      const name = await promptIfMissing(config, args, 'name', 'Display name', '--name');
      const transport = (getArgString(args, 'transport') ?? 'http') as 'http' | 'sse';
      const extraHeadersRaw = getArgString(args, 'extraHeaders');
      const extraHeaders = extraHeadersRaw
        ? (parseJsonArg(extraHeadersRaw, '--extra-headers') as Record<string, string>)
        : undefined;

      // Determine auth method. If --oauth or --bearer-token is passed
      // explicitly, honour it. Otherwise prompt interactively.
      let authMethod: 'none' | 'bearer' | 'oauth' = 'none';
      if (getArgBoolean(args, 'oauth') === true) {
        authMethod = 'oauth';
      } else if (getArgString(args, 'bearerToken') !== undefined) {
        authMethod = 'bearer';
      } else if (isInteractive(config.nonInteractive)) {
        authMethod = await promptSelect<'none' | 'bearer' | 'oauth'>(
          { nonInteractive: config.nonInteractive },
          'Authentication',
          [
            { value: 'none', label: 'No authentication', hint: 'Public server' },
            { value: 'bearer', label: 'Bearer token', hint: 'API key / token' },
            { value: 'oauth', label: 'OAuth', hint: 'Opens browser to authorize' },
          ]
        );
      }

      if (authMethod === 'oauth') {
        const scope = getArgString(args, 'scope');
        const check = canWaitForBrowser(config) ? await integrationArrivalCheck(api, workspaceId, 'mcp') : null;
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
        await confirmBrowserConnect(config, check, name);
        return;
      }

      let bearerToken = getArgString(args, 'bearerToken');
      if (authMethod === 'bearer' && !bearerToken) {
        bearerToken = await promptPassword({ nonInteractive: config.nonInteractive }, 'Bearer token');
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
      return;
    }

    // --- Credential-based connects ---
    let body: ConnectBody;
    if (type === 'datadog') {
      const site = await promptChoice(
        config,
        args,
        'site',
        '--site',
        'Datadog site — the one in your Datadog URL',
        DATADOG_SITES
      );
      const apiKey = await promptSecret(config, args, 'apiKey', '--api-key', {
        message: 'Datadog API key',
        instructions:
          'Create an API key in your Datadog organization settings, then paste it here. This is an org-level credential used to authenticate requests.',
        link: `https://app.${site}/organization-settings/api-keys`,
        linkLabel: 'Create API key',
      });
      const appKey = await promptSecret(config, args, 'appKey', '--app-key', {
        message: 'Datadog application key',
        instructions:
          'Create an application key, then paste it here. This is a user-level credential that controls what data Polylane can access.',
        link: `https://app.${site}/organization-settings/application-keys`,
        linkLabel: 'Create application key',
      });
      body = { type: 'datadog', workspaceId, site, apiKey, appKey };
    } else if (type === 'honeycomb') {
      const region = await promptChoice<'us' | 'eu'>(
        config,
        args,
        'region',
        '--region',
        'Honeycomb region — the one in your Honeycomb URL',
        [
          { value: 'us', label: 'US (api.honeycomb.io)' },
          { value: 'eu', label: 'EU (api.eu1.honeycomb.io)' },
        ],
        { strict: true }
      );
      const apiKey = await promptSecret(config, args, 'apiKey', '--api-key', {
        message: 'Honeycomb configuration API key',
        instructions:
          'In your Honeycomb environment settings, open API Keys, switch to the Configuration tab, and create a key named "polylane" with these permissions: Create Datasets, Manage Queries and Columns, Manage Public Boards, Manage Triggers, Manage Recipients, Manage Markers.',
        link: 'https://ui.honeycomb.io',
        linkLabel: 'Open Honeycomb settings',
      });
      body = { type: 'honeycomb', workspaceId, region, apiKey };
    } else if (type === 'axiom') {
      const region = await promptChoice<'us-east-1' | 'eu-central-1'>(
        config,
        args,
        'region',
        '--region',
        'Axiom edge deployment region — see your organization settings (https://app.axiom.co/settings/org)',
        [
          { value: 'us-east-1', label: 'US East 1' },
          { value: 'eu-central-1', label: 'EU Central 1' },
        ],
        { strict: true }
      );
      const apiToken = await promptSecret(config, args, 'apiToken', '--api-token', {
        message: 'Axiom API token',
        instructions:
          'In your Axiom settings, navigate to API Tokens and create a new token named "polylane" with all permissions.',
        link: 'https://app.axiom.co',
        linkLabel: 'Open Axiom settings',
      });
      body = { type: 'axiom', workspaceId, region, apiToken };
    } else if (type === 'betterstack') {
      const apiToken = await promptSecret(config, args, 'apiToken', '--api-token', {
        message: 'Better Stack global API token',
        instructions:
          'In Better Stack, open your organization settings, navigate to API tokens, and create a global API token.',
        link: 'https://betterstack.com/settings/global-api-tokens',
        linkLabel: 'Create global API token',
      });
      const uptimeApiToken = await promptSecret(config, args, 'uptimeApiToken', '--uptime-api-token', {
        message: 'Better Stack Uptime API token',
        instructions:
          "In the API token settings, switch to the Team-based tokens tab and copy your team's Uptime API token.",
        link: 'https://betterstack.com/settings/global-api-tokens',
        linkLabel: 'Open API token settings',
      });
      const telemetryApiToken = await promptSecret(config, args, 'telemetryApiToken', '--telemetry-api-token', {
        message: 'Better Stack Telemetry API token',
        instructions:
          'In Telemetry, open your team settings, navigate to API tokens, and copy your Telemetry API token.',
        link: 'https://telemetry.betterstack.com',
        linkLabel: 'Open Telemetry settings',
      });
      body = { type: 'betterstack', workspaceId, apiToken, uptimeApiToken, telemetryApiToken };
    } else {
      const agent = CODE_AGENTS[type];
      const apiKey = await promptSecret(config, args, 'apiKey', '--api-key', {
        message: `${agent.name} API key`,
        instructions: agent.instructions,
        link: agent.link,
        linkLabel: agent.linkLabel,
      });
      // Matches the console default: route autofixes through the agent unless
      // the user opts out.
      let useAsDefaultExecutor = getArgBoolean(args, 'noDefaultExecutor') !== true;
      if (useAsDefaultExecutor && isInteractive(config.nonInteractive)) {
        useAsDefaultExecutor = await promptConfirm(
          { nonInteractive: config.nonInteractive },
          `Use ${agent.name} for all autofixes? (instead of the Polylane executor — you can change this later)`,
          true
        );
      }
      body = { type, workspaceId, apiKey, useAsDefaultExecutor };
    }

    const integration = await api.integrationsConnect(body);
    printConnectSuccess(config, integration, TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type);
  },
};
