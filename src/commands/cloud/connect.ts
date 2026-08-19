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
  { value: 'cloudflare', label: 'Cloudflare', hint: 'read-only API token' },
  { value: 'vercel', label: 'Vercel', hint: 'install the Vercel integration (browser)' },
  { value: 'fly', label: 'Fly.io', hint: 'API token' },
  { value: 'render', label: 'Render', hint: 'API key' },
  { value: 'planetscale', label: 'PlanetScale', hint: 'authorize in the browser, or a service token' },
  { value: 'supabase', label: 'Supabase', hint: 'authorize in the browser' },
  { value: 'modal', label: 'Modal', hint: 'token ID + secret' },
  { value: 'kubernetes', label: 'Kubernetes', hint: 'in-cluster agent, installed with Helm (console)' },
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

// A completed handoff is only counted as connected when the account actually
// showed up — a timed-out wait must not look like a success to the caller's
// exit code.
export type ConnectOutcome = 'connected' | 'timeout';

export interface AccountBaseline {
  existing: CloudAccount[];
  check: () => Promise<CloudAccount[] | null>;
}

// Baseline the accounts of one provider: what already exists (for the
// already-connected short-circuit) plus a poller that spots the ones the
// browser flow creates — or updates, when it's a reconnect.
export async function accountBaseline(
  api: PolylaneAPI,
  workspaceId: string,
  provider: Provider
): Promise<AccountBaseline> {
  const before = await api.cloudAccountsList(workspaceId, { provider, perPage: 100 });
  const seen = new Map(before.items.map((a) => [a.id, a.updated ?? '']));
  const check = async (): Promise<CloudAccount[] | null> => {
    const current = await api.cloudAccountsList(workspaceId, { provider, perPage: 100 });
    const fresh = current.items.filter((a) => !seen.has(a.id) || seen.get(a.id) !== (a.updated ?? ''));
    return fresh.length > 0 ? fresh : null;
  };
  return { existing: before.items, check };
}

function printAlreadyConnected(config: Config, name: string, accounts: CloudAccount[]): void {
  if (config.output === 'json') {
    formatOutput(config, { accounts });
    return;
  }
  process.stderr.write(`✓ ${name} is already connected.\n`);
  if (!config.quiet) {
    process.stderr.write('Re-run with --reconnect to go through the connect flow again.\n');
  }
}

async function confirmBrowserConnect(
  config: Config,
  check: (() => Promise<CloudAccount[] | null>) | null,
  label: string,
  opts: { startHint?: string; timeoutMs?: number; intervalMs?: number } = {}
): Promise<ConnectOutcome> {
  if (!check) {
    if (!config.quiet && config.output !== 'json') {
      process.stderr.write('\nAfter finishing in the browser, check with `polylane cloud list`.\n');
    }
    return 'connected';
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
    return 'connected';
  }
  process.stderr.write('Timed out waiting — the connection has not shown up yet. Check with `polylane cloud list`.\n');
  return 'timeout';
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
    process.stderr.write(`Couldn't connect ${failure.account}: ${failure.message}\n`);
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
// When the provider is already connected, succeed without opening a browser —
// only an explicit --reconnect takes the wait-for-update path.
async function browserConnect(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string,
  provider: 'vercel' | 'planetscale' | 'supabase',
  name: string,
  label: string,
  noBrowser: boolean,
  reconnect: boolean
): Promise<ConnectOutcome> {
  const baseline = config.dryRun ? null : await accountBaseline(api, workspaceId, provider);
  if (baseline && !reconnect && baseline.existing.length > 0) {
    printAlreadyConnected(config, name, baseline.existing);
    return 'connected';
  }
  const check = canWaitForBrowser(config) && baseline ? baseline.check : null;
  await openOrPrintInstallUrl(config, cliConnectUrl(config, provider, workspaceId), label, noBrowser);
  return confirmBrowserConnect(config, check, `${label} to connect`);
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
): Promise<typeof BACK | ConnectOutcome> {
  const ctx = { nonInteractive: config.nonInteractive };
  const reconnect = getArgBoolean(args, 'reconnect') === true;

  // --- Browser flows: setup completes in the browser, then the CLI waits
  // for the account to appear so the session ends with a result ---
  if (provider === 'vercel') {
    return browserConnect(config, api, workspaceId, 'vercel', 'Vercel', 'the Vercel integration', noBrowser, reconnect);
  }
  if (provider === 'supabase') {
    return browserConnect(config, api, workspaceId, 'supabase', 'Supabase', 'your Supabase organization', noBrowser, reconnect);
  }
  if (provider === 'planetscale') {
    // Service-token flags take the direct path; otherwise authorize in the
    // browser like the console.
    const tokenId = getArgString(args, 'tokenId');
    const token = getArgString(args, 'token');
    const organization = getArgString(args, 'organization');
    if (tokenId === undefined && token === undefined && organization === undefined) {
      return browserConnect(config, api, workspaceId, 'planetscale', 'PlanetScale', 'your PlanetScale organization', noBrowser, reconnect);
    }
    if (!tokenId || !token || !organization) {
      throw new CLIError(
        'PlanetScale service-token connect needs --token-id, --token and --organization',
        ExitCode.USAGE,
        'Create a service token at https://app.planetscale.com/~/settings/service-tokens with organization access read_organization and, for all databases, read_database and read_branch. Or pass none of the flags to authorize in the browser instead.'
      );
    }
    const result = await api.cloudAccountsConnect({ workspaceId, provider: 'planetscale', tokenId, token, organization });
    printConnectSuccess(config, result);
    return 'connected';
  }
  if (provider === 'kubernetes') {
    // The kubeconfig upload no longer exists in the API: Kubernetes connects
    // through the in-cluster Polylane agent, which registers itself and opens
    // an outbound tunnel, so there is nothing to paste here. Hand off to the
    // console's Helm install and wait for the cluster to appear.
    const docsUrl = 'https://docs.polylane.com/integrations/kubernetes';
    const baseline = config.dryRun ? null : await accountBaseline(api, workspaceId, 'kubernetes');
    if (baseline && !reconnect && baseline.existing.length > 0) {
      printAlreadyConnected(config, 'Kubernetes', baseline.existing);
      return 'connected';
    }
    if (config.output === 'json') {
      formatOutput(config, { url: docsUrl });
      return 'connected';
    }
    const check = canWaitForBrowser(config) && baseline ? baseline.check : null;
    note(
      [
        'Kubernetes connects through the in-cluster Polylane agent: install it with Helm and it registers itself and opens an outbound tunnel. No kubeconfig or token to paste.',
        'Get the Helm command from your console: Settings > Clouds > Connect > Kubernetes.',
        `Docs: ${docsUrl}`,
      ].join('\n'),
      'Connect Kubernetes'
    );
    return confirmBrowserConnect(config, check, 'the agent to register (run the Helm install now)', {
      startHint: 'Run the Helm install from your console, then come back to this terminal.',
      timeoutMs: 15 * 60_000,
      intervalMs: 5_000,
    });
  }

  let body: ConnectBody;
  let awsBaseline: AccountBaseline | null = null;
  if (provider === 'aws') {
    // Short-circuit before the wizard when AWS is already connected — unless
    // an explicit --account targets an account that is not connected yet.
    awsBaseline = config.dryRun ? null : await accountBaseline(api, workspaceId, 'aws');
    const accountFlag = getArgString(args, 'account');
    if (
      awsBaseline &&
      !reconnect &&
      awsBaseline.existing.length > 0 &&
      (accountFlag === undefined || awsBaseline.existing.some((a) => a.account === accountFlag))
    ) {
      printAlreadyConnected(config, 'AWS', awsBaseline.existing);
      return 'connected';
    }
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
    // Always read-only. The docs page offers two pre-filled tokens (read+write
    // first, read-only second), so the copy has to name the read-only one by
    // its button label: a token minted from the other link and pasted here
    // would be stored under a read-only label it does not have, and every
    // write for the account would then be refused with no way to re-enable it.
    // Read-only is also what both console connect surfaces send.
    let token = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'token',
        '--token',
        {
          message: 'Cloudflare API token',
          instructions:
            'On the docs page, use the "Create read-only token" link: it opens Cloudflare\'s account API token screen with a pre-filled, read-only token. Create it as-is and paste it here. You must be a Super Administrator on the account.',
          link: 'https://docs.polylane.com/integrations/cloudflare',
          linkLabel: 'Create the token (use the read-only link)',
        },
        (v) => {
          token = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { workspaceId, provider: 'cloudflare', token, readOnly: true };
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
          instructions:
            'In the Fly.io dashboard, pick your organization, then Tokens, and create an org token. An org token is needed for image rollback remediation; a read-only token ("fly tokens create readonly -o <org>") covers sync and metrics only. Paste the whole value, including the leading "FlyV1 " prefix.',
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
          instructions:
            'Create a new API key in your Render account settings. Render keys have no scopes; the key acts as you in every workspace you belong to. Create it from an account with the Developer or Admin role (Viewer and Contributor cannot read env vars or connection strings). Starts with rnd_ and is shown only once.',
          link: 'https://dashboard.render.com/u/settings?add-api-key',
          linkLabel: 'Create API key',
        },
        (v) => {
          apiKey = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { workspaceId, provider: 'render', apiKey };
  } else {
    // modal
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
            'Create a new token in your Modal settings; one token covers one workspace. Modal tokens have no scope picker and carry the creating account\'s access. On Team or Enterprise plans, create a Service User instead and give it the Viewer role on each environment. You get a token ID starting with ak- and a token secret starting with as-.',
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
  }

  // AWS ends in the browser too (deploying the CloudFormation stack); the
  // baseline snapshot from before the wizard lets the CLI wait for the
  // account after.
  const awsCheck = canWaitForBrowser(config) && awsBaseline ? awsBaseline.check : null;

  const result = await api.cloudAccountsConnect(body);

  // AWS returns a CloudFormation URL the user must open to deploy the stack.
  // Open it in the browser unless suppressed.
  if (result.provider === 'aws') {
    await openOrPrintInstallUrl(config, result.url, 'the AWS CloudFormation stack', noBrowser);
    return confirmBrowserConnect(config, awsCheck, 'the CloudFormation stack to deploy (usually a few minutes)', {
      timeoutMs: 15 * 60_000,
      intervalMs: 5_000,
    });
  }

  // All other providers return { accounts, failures } synchronously.
  printConnectSuccess(config, result);
  return 'connected';
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
    // Retired in 0.2.16: Cloudflare now always connects read-only, which is
    // what anyone passing this flag was asking for. Accepted and ignored for
    // one release so existing scripts do not start exiting 2 on an unknown
    // flag — delete this entry in 0.3.0.
    { flag: '--read-only', description: 'Deprecated: Cloudflare connects read-only either way; accepted and ignored', type: 'boolean' },
    // PlanetScale / Modal
    { flag: '--token-id <id>', description: 'PlanetScale service token ID, or Modal token ID', type: 'string' },
    { flag: '--token-secret <secret>', description: 'Modal token secret', type: 'string' },
    { flag: '--organization <org>', description: 'PlanetScale organization', type: 'string' },
    // Render
    { flag: '--api-key <key>', description: 'Render API key', type: 'string' },
    { flag: '--no-browser', description: 'AWS / Vercel / PlanetScale / Supabase: print the URL instead of opening it', type: 'boolean' },
    { flag: '--reconnect', description: 'AWS / Vercel / PlanetScale / Supabase / Kubernetes: run the connect flow even when the provider is already connected', type: 'boolean' },
  ],
  examples: [
    'polylane cloud connect',
    'polylane cloud connect --provider vercel',
    'polylane cloud connect --provider vercel --reconnect',
    'polylane cloud connect --provider cloudflare --token <token>',
    'polylane cloud connect --provider aws --account 123456789012 --region us-east-1 --subscribe-alarms',
    'polylane cloud connect --provider render --api-key <key>',
    'polylane cloud connect --provider supabase',
    'polylane cloud connect --provider planetscale --token-id <id> --token <token> --organization <org>',
    'polylane cloud connect --provider modal --token-id ak-... --token-secret as-...',
    'polylane cloud connect --provider kubernetes',
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
      const outcome = await connectProvider(config, api, args, workspaceId, provider, noBrowser);
      if (outcome !== BACK) {
        if (outcome === 'timeout') process.exitCode = ExitCode.GENERAL;
        return;
      }
      if (providerFromFlag) break;
    }
    cancel('Nothing connected.');
  },
};
