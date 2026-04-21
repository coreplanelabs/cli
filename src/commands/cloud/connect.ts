import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, getArgBoolean, promptIfMissing } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';

type ConnectBody = Parameters<NominalAPI['cloudAccountsConnect']>[0];

async function openOrPrintInstallUrl(config: Config, url: string, label: string, noBrowser: boolean): Promise<void> {
  if (config.output === 'json') {
    formatOutput(config, { url });
    return;
  }
  const shouldOpen = !noBrowser && isInteractive(config.nonInteractive);
  if (shouldOpen) {
    if (!config.quiet) {
      process.stderr.write(`Opening ${label} in your browser…\n`);
      process.stderr.write("If it doesn't open, use this URL:\n");
    }
    process.stdout.write(url + '\n');
    openBrowser(url);
  } else {
    if (!config.quiet) {
      process.stderr.write(`Open this URL to connect ${label}:\n`);
    }
    process.stdout.write(url + '\n');
  }
}

export const cloudConnectCommand: Command = {
  name: 'cloud connect',
  description: 'Connect a cloud account (aws | cloudflare | fly | render | vercel)',
  operationId: 'cloud_accounts.connect',
  options: [
    { flag: '--provider <p>', description: 'aws | cloudflare | fly | render | vercel', type: 'string' },
    // AWS
    { flag: '--account <id>', description: 'AWS 12-digit account ID', type: 'string' },
    { flag: '--region <region>', description: 'AWS region (e.g. us-east-1)', type: 'string' },
    { flag: '--create-alarms', description: 'AWS: create monitoring alarms', type: 'boolean' },
    { flag: '--subscribe-alarms', description: 'AWS: subscribe to existing alarms', type: 'boolean' },
    // Cloudflare / Fly
    { flag: '--token <token>', description: 'Cloudflare API token or Fly token', type: 'string' },
    // Render
    { flag: '--api-key <key>', description: 'Render API key', type: 'string' },
    { flag: '--no-browser', description: 'AWS / Vercel: print the install URL instead of opening it', type: 'boolean' },
  ],
  examples: [
    'nominal cloud connect --provider vercel',
    'nominal cloud connect --provider cloudflare --token <token>',
    'nominal cloud connect --provider aws --account 123456789012 --region us-east-1 --create-alarms',
    'nominal cloud connect --provider fly --token <token>',
    'nominal cloud connect --provider render --api-key <key>',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const provider = await promptIfMissing(
      config,
      args,
      'provider',
      'Provider (aws | cloudflare | fly | render | vercel)',
      '--provider'
    );
    const noBrowser = getArgBoolean(args, 'noBrowser') === true;
    const api = new NominalAPI(config);

    // Vercel uses an install URL flow (the OAuth callback comes back into the
    // API directly). Generate the URL and open it like integration github.
    if (provider === 'vercel') {
      const result = await api.cloudAccountsConnectVercelGenerate({ workspaceId });
      await openOrPrintInstallUrl(config, result.url, 'the Vercel integration', noBrowser);
      return;
    }

    let body: ConnectBody;
    if (provider === 'cloudflare') {
      const token = await promptIfMissing(config, args, 'token', 'Cloudflare API token', '--token');
      body = { workspaceId, provider: 'cloudflare', token };
    } else if (provider === 'aws') {
      const account = await promptIfMissing(config, args, 'account', 'AWS account ID (12 digits)', '--account');
      const region = await promptIfMissing(config, args, 'region', 'AWS region', '--region');
      const createMonitoringAlarms = getArgBoolean(args, 'createAlarms') === true;
      const subscribeToAlarms = getArgBoolean(args, 'subscribeAlarms') === true;
      body = {
        workspaceId,
        provider: 'aws',
        account,
        region,
        ...(createMonitoringAlarms ? { createMonitoringAlarms } : {}),
        ...(subscribeToAlarms ? { subscribeToAlarms } : {}),
      };
    } else if (provider === 'fly') {
      const token = await promptIfMissing(config, args, 'token', 'Fly token', '--token');
      body = { workspaceId, provider: 'fly', token };
    } else if (provider === 'render') {
      const apiKey = await promptIfMissing(config, args, 'apiKey', 'Render API key', '--api-key');
      body = { workspaceId, provider: 'render', apiKey };
    } else {
      throw new CLIError(
        `Unknown provider: ${provider}`,
        ExitCode.USAGE,
        'Use aws | cloudflare | fly | render | vercel'
      );
    }

    const result = await api.cloudAccountsConnect(body);

    // AWS returns a CloudFormation URL the user must open to deploy the stack.
    // Open it in the browser unless suppressed.
    if (result.provider === 'aws') {
      await openOrPrintInstallUrl(config, result.url, 'the AWS CloudFormation stack', noBrowser);
      if (!config.quiet) {
        process.stderr.write(
          '\nAfter the stack finishes deploying, run `nominal cloud list` to see the account.\n'
        );
      }
      return;
    }

    // All other providers return { accounts, failures } synchronously.
    formatOutput(config, result);
    if ('failures' in result && result.failures.length > 0 && !config.quiet) {
      process.stderr.write(`\n${result.failures.length} account(s) failed to connect — see "failures" above.\n`);
    }
  },
};
