import { readFileSync, existsSync } from 'node:fs';

import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { requestJson } from '../../client/http';
import { formatOutput } from '../../output/formatter';
import {
  requireWorkspace,
  getArgString,
  getArgBoolean,
  promptIfMissing,
  promptChoice,
  promptSecret,
} from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';
import { promptConfirm, promptText, note } from '../../utils/prompt';

type ConnectBody = Parameters<PolylaneAPI['cloudAccountsConnect']>[0];

type Provider =
  | 'aws'
  | 'cloudflare'
  | 'vercel'
  | 'fly'
  | 'render'
  | 'planetscale'
  | 'supabase'
  | 'modal'
  | 'kubernetes';

const PROVIDER_OPTIONS: Array<{ value: Provider; label: string; hint: string }> = [
  { value: 'aws', label: 'AWS', hint: 'deploys a read-only CloudFormation stack (browser)' },
  { value: 'cloudflare', label: 'Cloudflare', hint: 'API token' },
  { value: 'vercel', label: 'Vercel', hint: 'install the Vercel integration (browser)' },
  { value: 'fly', label: 'Fly.io', hint: 'API token' },
  { value: 'render', label: 'Render', hint: 'API key' },
  { value: 'planetscale', label: 'PlanetScale', hint: 'authorize in the browser, or a service token' },
  { value: 'supabase', label: 'Supabase', hint: 'authorize in the browser' },
  { value: 'modal', label: 'Modal', hint: 'token ID + secret' },
  { value: 'kubernetes', label: 'Kubernetes', hint: 'kubeconfig file' },
];

// Same region list the console offers; the flag accepts any region so accounts
// in regions not listed here are not locked out.
const AWS_REGIONS = [
  { value: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
  { value: 'us-east-2', label: 'us-east-2 (Ohio)' },
  { value: 'us-west-1', label: 'us-west-1 (N. California)' },
  { value: 'us-west-2', label: 'us-west-2 (Oregon)' },
  { value: 'eu-central-1', label: 'eu-central-1 (Frankfurt)' },
  { value: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
  { value: 'eu-west-2', label: 'eu-west-2 (London)' },
  { value: 'ap-south-1', label: 'ap-south-1 (Mumbai)' },
  { value: 'ap-southeast-1', label: 'ap-southeast-1 (Singapore)' },
  { value: 'ap-southeast-2', label: 'ap-southeast-2 (Sydney)' },
  { value: 'ap-northeast-1', label: 'ap-northeast-1 (Tokyo)' },
  { value: 'ca-central-1', label: 'ca-central-1 (Central)' },
  { value: 'eu-north-1', label: 'eu-north-1 (Stockholm)' },
  { value: 'sa-east-1', label: 'sa-east-1 (São Paulo)' },
];

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

// PlanetScale and Supabase use the same browser OAuth flow the console does:
// a hidden generate endpoint returns the authorization URL and the callback
// lands back in the API. Neither endpoint is in the public OpenAPI spec, so
// call the paths directly.
async function oauthConnect(
  config: Config,
  workspaceId: string,
  provider: 'planetscale' | 'supabase',
  label: string,
  noBrowser: boolean
): Promise<void> {
  const result = await requestJson<{ url: string }>(config, {
    method: 'POST',
    url: `/v1/cloud_accounts/${provider}/generate`,
    body: { workspaceId },
  });
  await openOrPrintInstallUrl(config, result.url, label, noBrowser);
  if (!config.quiet && config.output !== 'json') {
    process.stderr.write('\nAfter authorizing, run `polylane cloud list` to see the account.\n');
  }
}

export const cloudConnectCommand: Command = {
  name: 'cloud connect',
  description: 'Connect a cloud account (AWS, Cloudflare, Vercel, Fly.io, Render, PlanetScale, Supabase, Modal, Kubernetes)',
  operationId: 'cloud_accounts.connect',
  options: [
    {
      flag: '--provider <p>',
      description: `${PROVIDER_OPTIONS.map((o) => o.value).join(' | ')} (prompted if omitted)`,
      type: 'string',
    },
    // AWS
    { flag: '--account <id>', description: 'AWS 12-digit account ID', type: 'string' },
    { flag: '--region <region>', description: 'AWS region (e.g. us-east-1)', type: 'string' },
    { flag: '--create-alarms', description: 'AWS: create monitoring alarms', type: 'boolean' },
    { flag: '--subscribe-alarms', description: 'AWS: subscribe to existing CloudWatch alarms', type: 'boolean' },
    // Cloudflare / Fly / PlanetScale
    { flag: '--token <token>', description: 'Cloudflare API token, Fly.io token, or PlanetScale service token', type: 'string' },
    { flag: '--read-only', description: 'Cloudflare: the token only has read permissions', type: 'boolean' },
    // PlanetScale / Modal
    { flag: '--token-id <id>', description: 'PlanetScale service token ID, or Modal token ID', type: 'string' },
    { flag: '--token-secret <secret>', description: 'Modal token secret', type: 'string' },
    { flag: '--organization <org>', description: 'PlanetScale organization', type: 'string' },
    // Render
    { flag: '--api-key <key>', description: 'Render API key', type: 'string' },
    // Kubernetes
    { flag: '--kubeconfig <path>', description: 'Kubernetes: path to a kubeconfig file', type: 'string' },
    { flag: '--no-browser', description: 'AWS / Vercel / PlanetScale / Supabase: print the URL instead of opening it', type: 'boolean' },
  ],
  examples: [
    'polylane cloud connect',
    'polylane cloud connect --provider vercel',
    'polylane cloud connect --provider cloudflare --token <token>',
    'polylane cloud connect --provider aws --account 123456789012 --region us-east-1 --subscribe-alarms',
    'polylane cloud connect --provider render --api-key <key>',
    'polylane cloud connect --provider supabase',
    'polylane cloud connect --provider planetscale --token-id <id> --token <token> --organization <org>',
    'polylane cloud connect --provider modal --token-id ak-... --token-secret as-...',
    'polylane cloud connect --provider kubernetes --kubeconfig ~/.kube/config',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const provider = await promptChoice<Provider>(
      config,
      args,
      'provider',
      '--provider',
      'Which cloud do you want to connect?',
      PROVIDER_OPTIONS,
      { strict: true }
    );
    const noBrowser = getArgBoolean(args, 'noBrowser') === true;
    const api = new PolylaneAPI(config);

    // --- Browser flows: setup completes outside the CLI ---
    if (provider === 'vercel') {
      const result = await api.cloudAccountsConnectVercelGenerate({ workspaceId });
      await openOrPrintInstallUrl(config, result.url, 'the Vercel integration', noBrowser);
      return;
    }
    if (provider === 'supabase') {
      await oauthConnect(config, workspaceId, 'supabase', 'your Supabase organization', noBrowser);
      return;
    }
    if (provider === 'planetscale') {
      // Service-token flags take the direct path; otherwise authorize in the
      // browser like the console.
      const tokenId = getArgString(args, 'tokenId');
      const token = getArgString(args, 'token');
      const organization = getArgString(args, 'organization');
      if (tokenId === undefined && token === undefined && organization === undefined) {
        await oauthConnect(config, workspaceId, 'planetscale', 'your PlanetScale organization', noBrowser);
        return;
      }
      if (!tokenId || !token || !organization) {
        throw new CLIError(
          'PlanetScale service-token connect needs --token-id, --token and --organization',
          ExitCode.USAGE,
          'Or pass none of them to authorize in the browser instead'
        );
      }
      const result = await api.cloudAccountsConnect({ workspaceId, provider: 'planetscale', tokenId, token, organization });
      formatOutput(config, result);
      return;
    }

    let body: ConnectBody;
    if (provider === 'aws') {
      const account = await promptIfMissing(config, args, 'account', 'AWS account ID (12 digits)', '--account');
      const region = await promptChoice(config, args, 'region', '--region', 'AWS region', AWS_REGIONS);
      const createMonitoringAlarms = getArgBoolean(args, 'createAlarms') === true;
      let subscribeToAlarms = getArgBoolean(args, 'subscribeAlarms') === true;
      if (!subscribeToAlarms && getArgString(args, 'account') === undefined && isInteractive(config.nonInteractive)) {
        subscribeToAlarms = await promptConfirm(
          { nonInteractive: config.nonInteractive },
          'Investigate alarms? (Polylane subscribes to all CloudWatch alarms in this account and investigates them when they fire)',
          true
        );
      }
      body = {
        workspaceId,
        provider: 'aws',
        account,
        region,
        ...(createMonitoringAlarms ? { createMonitoringAlarms } : {}),
        ...(subscribeToAlarms ? { subscribeToAlarms } : {}),
      };
    } else if (provider === 'cloudflare') {
      const token = await promptSecret(config, args, 'token', '--token', {
        message: 'Cloudflare API token',
        instructions:
          'Create an API token for your account, then paste it here. The docs page has links that pre-fill the permissions Polylane needs (read-only or read-write).',
        link: 'https://docs.polylane.com/integrations/cloudflare',
        linkLabel: 'How to create the token',
      });
      let readOnly = getArgBoolean(args, 'readOnly') === true;
      if (!readOnly && getArgString(args, 'token') === undefined && isInteractive(config.nonInteractive)) {
        readOnly = !(await promptConfirm(
          { nonInteractive: config.nonInteractive },
          'Does the token have write permissions?',
          true
        ));
      }
      body = { workspaceId, provider: 'cloudflare', token, ...(readOnly ? { readOnly } : {}) };
    } else if (provider === 'fly') {
      const token = await promptSecret(config, args, 'token', '--token', {
        message: 'Fly.io API token',
        instructions: 'Open your Fly.io dashboard, navigate to Tokens, create a new token, then paste it here.',
        link: 'https://fly.io/dashboard',
        linkLabel: 'Open Fly.io dashboard',
      });
      body = { workspaceId, provider: 'fly', token };
    } else if (provider === 'render') {
      const apiKey = await promptSecret(config, args, 'apiKey', '--api-key', {
        message: 'Render API key',
        instructions: 'Create a new API key in your Render account settings, then paste it here.',
        link: 'https://dashboard.render.com/u/settings#api-keys',
        linkLabel: 'Create API key',
      });
      body = { workspaceId, provider: 'render', apiKey };
    } else if (provider === 'modal') {
      const tokenId = await promptSecret(config, args, 'tokenId', '--token-id', {
        message: 'Modal token ID',
        instructions:
          'Create a new token in your Modal settings. It gives you a token ID starting with ak- and a token secret starting with as-.',
        link: 'https://modal.com/settings/tokens',
        linkLabel: 'Create token',
      });
      const tokenSecret = await promptSecret(config, args, 'tokenSecret', '--token-secret', {
        message: 'Modal token secret',
        instructions: 'Paste the token secret (as-…) that came with the token ID.',
        link: 'https://modal.com/settings/tokens',
        linkLabel: 'Open Modal tokens',
      });
      body = { workspaceId, provider: 'modal', tokenId, tokenSecret };
    } else {
      // kubernetes: send a kubeconfig. The agent-based install (Helm, no
      // credentials to paste) lives in the console — point at the docs.
      let kubeconfigPath = getArgString(args, 'kubeconfig');
      if (kubeconfigPath === undefined) {
        if (!isInteractive(config.nonInteractive)) {
          throw new CLIError(`Missing required flag: --kubeconfig`, ExitCode.USAGE);
        }
        note(
          'Polylane connects with a kubeconfig file. Prefer the in-cluster agent (Helm install, no credentials to paste)? Use the console — see the docs:\n  https://docs.polylane.com/integrations/kubernetes',
          'Connect Kubernetes'
        );
        kubeconfigPath = await promptText(
          { nonInteractive: config.nonInteractive },
          'Path to kubeconfig',
          { defaultValue: '~/.kube/config', placeholder: '~/.kube/config' }
        );
      }
      const resolved = kubeconfigPath.replace(/^~(?=\/|$)/, process.env.HOME ?? '~');
      if (!existsSync(resolved)) {
        throw new CLIError(`kubeconfig not found: ${resolved}`, ExitCode.USAGE);
      }
      body = { workspaceId, provider: 'kubernetes', kubeconfig: readFileSync(resolved, 'utf-8') };
    }

    const result = await api.cloudAccountsConnect(body);

    // AWS returns a CloudFormation URL the user must open to deploy the stack.
    // Open it in the browser unless suppressed.
    if (result.provider === 'aws') {
      await openOrPrintInstallUrl(config, result.url, 'the AWS CloudFormation stack', noBrowser);
      if (!config.quiet) {
        process.stderr.write(
          '\nAfter the stack finishes deploying, run `polylane cloud list` to see the account.\n'
        );
      }
      return;
    }

    // All other providers return { accounts, failures } synchronously.
    formatOutput(config, result);
    if ('failures' in result && result.failures.length > 0 && !config.quiet) {
      const n = result.failures.length;
      process.stderr.write(`\n${n} account${n === 1 ? '' : 's'} failed to connect — see "failures" above.\n`);
    }
  },
};
