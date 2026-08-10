import { readFileSync, existsSync } from 'node:fs';

import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import {
  requireWorkspace,
  getArgString,
  getArgBoolean,
  promptChoice,
  canWaitForBrowser,
  waitForBrowserCompletion,
  cliConnectUrl,
  runSteps,
  textStep,
  choiceStep,
  secretStep,
  SKIPPED,
} from '../helpers';
import type { CloudAccount } from '../../generated/types';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';
import {
  BACK,
  cancel,
  note,
  promptSelectOrBack,
  promptTextOrBack,
  promptConfirmOrBack,
} from '../../utils/prompt';

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

// Baseline the accounts of one provider so the poller can spot the ones the
// browser flow creates — or updates, when it's a reconnect.
async function accountArrivalCheck(
  api: PolylaneAPI,
  workspaceId: string,
  provider: Provider
): Promise<() => Promise<CloudAccount[] | null>> {
  const before = await api.cloudAccountsList(workspaceId, { provider, perPage: 100 });
  const seen = new Map(before.items.map((a) => [a.id, a.updated ?? '']));
  return async () => {
    const current = await api.cloudAccountsList(workspaceId, { provider, perPage: 100 });
    const fresh = current.items.filter((a) => !seen.has(a.id) || seen.get(a.id) !== (a.updated ?? ''));
    return fresh.length > 0 ? fresh : null;
  };
}

async function confirmBrowserConnect(
  config: Config,
  check: (() => Promise<CloudAccount[] | null>) | null,
  label: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  if (!check) {
    if (!config.quiet && config.output !== 'json') {
      process.stderr.write('\nAfter finishing in the browser, check with `polylane cloud list`.\n');
    }
    return;
  }
  const found = await waitForBrowserCompletion(config, check, {
    waitingFor: label,
    interruptHint: 'Check with `polylane cloud list`.',
    ...opts,
  });
  if (found) {
    for (const account of found) {
      const detail = [account.account, account.region].filter(Boolean).join(', ');
      process.stderr.write(`✓ Connected: ${account.alias || account.account}${detail ? ` (${detail})` : ''}\n`);
    }
  } else {
    process.stderr.write('Not seeing the connection yet — check with `polylane cloud list`.\n');
  }
}

type ConnectResult = Awaited<ReturnType<PolylaneAPI['cloudAccountsConnect']>>;

function printConnectSuccess(config: Config, result: ConnectResult): void {
  if (config.output === 'json' || !('accounts' in result)) {
    formatOutput(config, result);
    return;
  }
  for (const account of result.accounts) {
    const detail = [account.account, account.region].filter(Boolean).join(', ');
    process.stderr.write(`✓ Connected: ${account.alias || account.account}${detail ? ` (${detail})` : ''}\n`);
  }
  for (const failure of result.failures) {
    process.stderr.write(`Failed to connect ${failure.account}: ${failure.message}\n`);
  }
}

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

// Vercel, PlanetScale and Supabase complete in the browser: the flow enters
// via the console's /cli/connect page (which ends the journey on its "go back
// to your terminal" page) while the CLI waits for the account to appear.
async function browserConnect(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string,
  provider: 'vercel' | 'planetscale' | 'supabase',
  label: string,
  noBrowser: boolean
): Promise<void> {
  const check = canWaitForBrowser(config) ? await accountArrivalCheck(api, workspaceId, provider) : null;
  await openOrPrintInstallUrl(config, cliConnectUrl(config, provider, workspaceId), label, noBrowser);
  await confirmBrowserConnect(config, check, `${label} to connect`);
}

// Each wizard step can go back to the previous one; backing out of the first
// returns BACK to re-open provider selection.
async function connectProvider(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string,
  provider: Provider,
  noBrowser: boolean
): Promise<typeof BACK | void> {
  const ctx = { nonInteractive: config.nonInteractive };

  // --- Browser flows: setup completes in the browser, then the CLI waits
  // for the account to appear so the session ends with a result ---
  if (provider === 'vercel') {
    await browserConnect(config, api, workspaceId, 'vercel', 'the Vercel integration', noBrowser);
    return;
  }
  if (provider === 'supabase') {
    await browserConnect(config, api, workspaceId, 'supabase', 'your Supabase organization', noBrowser);
    return;
  }
  if (provider === 'planetscale') {
    // Service-token flags take the direct path; otherwise authorize in the
    // browser like the console.
    const tokenId = getArgString(args, 'tokenId');
    const token = getArgString(args, 'token');
    const organization = getArgString(args, 'organization');
    if (tokenId === undefined && token === undefined && organization === undefined) {
      await browserConnect(config, api, workspaceId, 'planetscale', 'your PlanetScale organization', noBrowser);
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
    printConnectSuccess(config, result);
    return;
  }

  let body: ConnectBody;
  if (provider === 'aws') {
    let account = '';
    let region = '';
    let subscribeToAlarms = getArgBoolean(args, 'subscribeAlarms') === true;
    const ok = await runSteps([
      textStep(config, args, 'account', 'AWS account ID (12 digits)', '--account', (v) => {
        account = v;
      }),
      choiceStep(config, args, 'region', '--region', 'AWS region', AWS_REGIONS, (v) => {
        region = v;
      }),
      async () => {
        if (
          getArgBoolean(args, 'subscribeAlarms') === true ||
          getArgString(args, 'account') !== undefined ||
          !isInteractive(config.nonInteractive)
        ) {
          return SKIPPED;
        }
        const answer = await promptConfirmOrBack(
          ctx,
          'Investigate alarms? (Polylane subscribes to all CloudWatch alarms in this account and investigates them when they fire)',
          true
        );
        if (answer === BACK) return BACK;
        subscribeToAlarms = answer;
        return;
      },
    ]);
    if (!ok) return BACK;
    const createMonitoringAlarms = getArgBoolean(args, 'createAlarms') === true;
    body = {
      workspaceId,
      provider: 'aws',
      account,
      region,
      ...(createMonitoringAlarms ? { createMonitoringAlarms } : {}),
      ...(subscribeToAlarms ? { subscribeToAlarms } : {}),
    };
  } else if (provider === 'cloudflare') {
    let token = '';
    let readOnly = getArgBoolean(args, 'readOnly') === true;
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'token',
        '--token',
        {
          message: 'Cloudflare API token',
          instructions:
            'Create an API token for your account, then paste it here. The docs page has links that pre-fill the permissions Polylane needs (read-only or read-write).',
          link: 'https://docs.polylane.com/integrations/cloudflare',
          linkLabel: 'How to create the token',
        },
        (v) => {
          token = v;
        }
      ),
      async () => {
        if (
          getArgBoolean(args, 'readOnly') === true ||
          getArgString(args, 'token') !== undefined ||
          !isInteractive(config.nonInteractive)
        ) {
          return SKIPPED;
        }
        const answer = await promptConfirmOrBack(ctx, 'Does the token have write permissions?', true);
        if (answer === BACK) return BACK;
        readOnly = !answer;
        return;
      },
    ]);
    if (!ok) return BACK;
    body = { workspaceId, provider: 'cloudflare', token, ...(readOnly ? { readOnly } : {}) };
  } else if (provider === 'fly') {
    let token = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'token',
        '--token',
        {
          message: 'Fly.io API token',
          instructions: 'Open your Fly.io dashboard, navigate to Tokens, create a new token, then paste it here.',
          link: 'https://fly.io/dashboard',
          linkLabel: 'Open Fly.io dashboard',
        },
        (v) => {
          token = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { workspaceId, provider: 'fly', token };
  } else if (provider === 'render') {
    let apiKey = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'apiKey',
        '--api-key',
        {
          message: 'Render API key',
          instructions: 'Create a new API key in your Render account settings, then paste it here.',
          link: 'https://dashboard.render.com/u/settings#api-keys',
          linkLabel: 'Create API key',
        },
        (v) => {
          apiKey = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { workspaceId, provider: 'render', apiKey };
  } else if (provider === 'modal') {
    let tokenId = '';
    let tokenSecret = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'tokenId',
        '--token-id',
        {
          message: 'Modal token ID',
          instructions:
            'Create a new token in your Modal settings. It gives you a token ID starting with ak- and a token secret starting with as-.',
          link: 'https://modal.com/settings/tokens',
          linkLabel: 'Create token',
        },
        (v) => {
          tokenId = v;
        }
      ),
      secretStep(
        config,
        args,
        'tokenSecret',
        '--token-secret',
        {
          message: 'Modal token secret',
          instructions: 'Paste the token secret (as-…) that came with the token ID.',
          link: 'https://modal.com/settings/tokens',
          linkLabel: 'Open Modal tokens',
        },
        (v) => {
          tokenSecret = v;
        }
      ),
    ]);
    if (!ok) return BACK;
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
      const answer = await promptTextOrBack(ctx, 'Path to kubeconfig', {
        defaultValue: '~/.kube/config',
        placeholder: '~/.kube/config',
      });
      if (answer === BACK) return BACK;
      kubeconfigPath = answer;
    }
    const resolved = kubeconfigPath.replace(/^~(?=\/|$)/, process.env.HOME ?? '~');
    if (!existsSync(resolved)) {
      throw new CLIError(`kubeconfig not found: ${resolved}`, ExitCode.USAGE);
    }
    body = { workspaceId, provider: 'kubernetes', kubeconfig: readFileSync(resolved, 'utf-8') };
  }

  // AWS ends in the browser too (deploying the CloudFormation stack), so
  // snapshot before connecting to be able to wait for the account after.
  const awsCheck =
    provider === 'aws' && canWaitForBrowser(config) ? await accountArrivalCheck(api, workspaceId, 'aws') : null;

  const result = await api.cloudAccountsConnect(body);

  // AWS returns a CloudFormation URL the user must open to deploy the stack.
  // Open it in the browser unless suppressed.
  if (result.provider === 'aws') {
    await openOrPrintInstallUrl(config, result.url, 'the AWS CloudFormation stack', noBrowser);
    await confirmBrowserConnect(config, awsCheck, 'the CloudFormation stack to deploy (usually a few minutes)', {
      timeoutMs: 15 * 60_000,
      intervalMs: 5_000,
    });
    return;
  }

  // All other providers return { accounts, failures } synchronously.
  printConnectSuccess(config, result);
  return;
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
    const noBrowser = getArgBoolean(args, 'noBrowser') === true;
    const api = new PolylaneAPI(config);
    const providerFromFlag = getArgString(args, 'provider') !== undefined;

    // Provider selection restarts whenever the user backs out of the first
    // step of the chosen flow, so nothing is committed until a flow completes.
    for (;;) {
      const provider =
        providerFromFlag || !isInteractive(config.nonInteractive)
          ? await promptChoice<Provider>(
              config,
              args,
              'provider',
              '--provider',
              'Which cloud do you want to connect?',
              PROVIDER_OPTIONS,
              { strict: true }
            )
          : await promptSelectOrBack<Provider>(
              { nonInteractive: config.nonInteractive },
              'Which cloud do you want to connect?',
              PROVIDER_OPTIONS,
              'Cancel'
            );
      if (provider === BACK) break;
      if ((await connectProvider(config, api, args, workspaceId, provider, noBrowser)) !== BACK) return;
      if (providerFromFlag) break;
    }
    cancel('Nothing connected.');
  },
};
