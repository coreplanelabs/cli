import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, getArgString, getArgBoolean, promptIfMissing, parseJsonArg } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';
import { promptSelect, promptPassword } from '../../utils/prompt';

type ConnectBody = Parameters<NominalAPI['integrationsConnect']>[0];

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
  description: 'Connect an integration (github | datadog | honeycomb | axiom | mcp)',
  operationId: 'integrations.connect',
  options: [
    { flag: '--type <type>', description: 'github | datadog | honeycomb | axiom | mcp', type: 'string' },
    { flag: '--site <site>', description: 'Datadog site (e.g. us5.datadoghq.com)', type: 'string' },
    { flag: '--region <region>', description: 'Honeycomb (us|eu) or Axiom (us-east-1|eu-central-1)', type: 'string' },
    { flag: '--api-key <key>', description: 'API key (Datadog / Honeycomb)', type: 'string' },
    { flag: '--app-key <key>', description: 'App key (Datadog only)', type: 'string' },
    { flag: '--api-token <token>', description: 'API token (Axiom only)', type: 'string' },
    { flag: '--url <url>', description: 'MCP server URL', type: 'string' },
    { flag: '--name <name>', description: 'MCP server display name', type: 'string' },
    { flag: '--transport <t>', description: 'MCP transport: http | sse (default: http)', type: 'string' },
    { flag: '--bearer-token <token>', description: 'MCP bearer token for direct auth', type: 'string' },
    { flag: '--extra-headers <json>', description: 'MCP extra headers as JSON object', type: 'string' },
    { flag: '--oauth', description: 'MCP: use OAuth flow (opens browser to authorize)', type: 'boolean' },
    { flag: '--scope <scope>', description: 'MCP OAuth scope', type: 'string' },
    { flag: '--no-browser', description: 'GitHub / MCP OAuth: print the URL instead of opening it', type: 'boolean' },
  ],
  examples: [
    'nominal integration connect --type github',
    'nominal integration connect --type datadog --site us5.datadoghq.com --api-key ... --app-key ...',
    'nominal integration connect --type honeycomb --region us --api-key ...',
    'nominal integration connect --type axiom --region us-east-1 --api-token ...',
    'nominal integration connect --type mcp --url https://mcp.example.com/sse --name "My MCP"',
    'nominal integration connect --type mcp --url https://mcp.example.com/sse --name "My MCP" --bearer-token ...',
    'nominal integration connect --type mcp --url https://mcp.example.com/sse --name "My MCP" --oauth',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const type = await promptIfMissing(
      config,
      args,
      'type',
      'Type (github | datadog | honeycomb | axiom | mcp)',
      '--type'
    );
    const noBrowser = getArgBoolean(args, 'noBrowser') === true;
    const api = new NominalAPI(config);

    // --- GitHub: install-URL flow ---
    if (type === 'github') {
      const result = await api.integrationsGithubGenerate({ workspaceId });
      await openOrPrintInstallUrl(config, result.url, 'the GitHub App', noBrowser);
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
          'How should this MCP server be authenticated?',
          [
            { value: 'none', label: 'No authentication', hint: 'Public server' },
            { value: 'bearer', label: 'Bearer token', hint: 'API key / token' },
            { value: 'oauth', label: 'OAuth', hint: 'Opens browser to authorize' },
          ]
        );
      }

      if (authMethod === 'oauth') {
        const scope = getArgString(args, 'scope');
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
          process.stderr.write('After authorizing, run `nominal integration list` to see the connected server.\n');
        }
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
      formatOutput(config, integration);
      return;
    }

    // --- Observability tools: credential-based connect ---
    let body: ConnectBody;
    if (type === 'datadog') {
      const site = await promptIfMissing(config, args, 'site', 'Datadog site', '--site');
      const apiKey = await promptIfMissing(config, args, 'apiKey', 'API key', '--api-key');
      const appKey = await promptIfMissing(config, args, 'appKey', 'App key', '--app-key');
      body = { type: 'datadog', workspaceId, site, apiKey, appKey };
    } else if (type === 'honeycomb') {
      const region = (await promptIfMissing(config, args, 'region', 'Region (us | eu)', '--region')) as
        | 'us'
        | 'eu';
      if (region !== 'us' && region !== 'eu') {
        throw new CLIError('Honeycomb region must be "us" or "eu"', ExitCode.USAGE);
      }
      const apiKey = await promptIfMissing(config, args, 'apiKey', 'API key', '--api-key');
      body = { type: 'honeycomb', workspaceId, region, apiKey };
    } else if (type === 'axiom') {
      const region = (await promptIfMissing(
        config,
        args,
        'region',
        'Region (us-east-1 | eu-central-1)',
        '--region'
      )) as 'us-east-1' | 'eu-central-1';
      if (region !== 'us-east-1' && region !== 'eu-central-1') {
        throw new CLIError('Axiom region must be "us-east-1" or "eu-central-1"', ExitCode.USAGE);
      }
      const apiToken = await promptIfMissing(config, args, 'apiToken', 'API token', '--api-token');
      body = { type: 'axiom', workspaceId, region, apiToken };
    } else {
      throw new CLIError(
        `Unknown integration type: ${type}`,
        ExitCode.USAGE,
        'Use github | datadog | honeycomb | axiom | mcp (see `nominal integration catalog`)'
      );
    }

    const integration = await api.integrationsConnect(body);
    formatOutput(config, integration);
  },
};
