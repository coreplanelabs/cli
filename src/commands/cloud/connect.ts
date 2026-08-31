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
  startBackgroundCompletion,
  cliConnectUrl,
  runSteps,
  textStep,
  choiceStep,
  secretStep,
  SKIPPED,
  type WizardStep,
} from '../helpers';
import { buildCloudflareTokenUrl } from './cloudflare-token-url';
import type { CloudAccount } from '../../generated/types';
import { isApiError } from '../../errors/api';
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
  promptPasswordOrBack,
  promptTextOrBack,
} from '../../utils/prompt';

type ConnectBody = Parameters<PolylaneAPI['cloudAccountsConnect']>[0];

type Provider =
  | 'aws'
  | 'cloudflare'
  | 'vercel'
  | 'fly'
  | 'render'
  | 'railway'
  | 'planetscale'
  | 'supabase'
  | 'modal'
  | 'convex'
  | 'clickhouse'
  | 'turso'
  | 'kubernetes';

const PROVIDER_OPTIONS: Array<{ value: Provider; label: string; hint: string }> = [
  { value: 'aws', label: 'AWS', hint: 'deploys a read-only CloudFormation stack (browser)' },
  { value: 'cloudflare', label: 'Cloudflare', hint: 'read-only API token' },
  { value: 'vercel', label: 'Vercel', hint: 'install the Vercel integration (browser)' },
  { value: 'fly', label: 'Fly.io', hint: 'API token' },
  { value: 'render', label: 'Render', hint: 'API key' },
  { value: 'railway', label: 'Railway', hint: 'workspace or account token' },
  { value: 'planetscale', label: 'PlanetScale', hint: 'authorize in the browser, or a service token' },
  { value: 'supabase', label: 'Supabase', hint: 'authorize in the browser' },
  { value: 'modal', label: 'Modal', hint: 'token ID + secret' },
  { value: 'convex', label: 'Convex', hint: 'team access token' },
  { value: 'clickhouse', label: 'ClickHouse', hint: 'API key ID + secret' },
  { value: 'turso', label: 'Turso', hint: 'platform API token' },
  { value: 'kubernetes', label: 'Kubernetes', hint: 'in-cluster agent, installed with Helm (console)' },
];

// Same region list the console offers; the flag accepts any region so accounts
// in regions not listed here are not locked out. The API takes a list, or null
// for every region enabled on the account (including regions enabled later).
const AWS_ALL_REGIONS = 'all';

export function parseAwsRegions(value: string): string[] | null {
  const regions = value
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  const hint = 'Pass one or more AWS regions (e.g. --region us-east-1,eu-west-1) or --region all';
  if (regions.length === 0) {
    throw new CLIError(`Invalid value for --region: "${value}"`, ExitCode.USAGE, hint);
  }
  const all = regions.some((r) => r.toLowerCase() === AWS_ALL_REGIONS);
  if (all && regions.length > 1) {
    throw new CLIError(`Invalid value for --region: "${value}" mixes "all" with specific regions`, ExitCode.USAGE, hint);
  }
  return all ? null : regions;
}

const AWS_REGIONS = [
  { value: AWS_ALL_REGIONS, label: 'All regions (every region enabled on the account, now and later)' },
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
// showed up — neither a timed-out wait nor a stack that is still creating may
// look like a success to the caller's exit code. 'pending' is the background
// AWS path only: the stack launch went through but the account has not
// arrived by the time the session ends, so the command exits PENDING after
// telling the user how to check.
export type HandoffOutcome = 'connected' | 'timeout';
export type ConnectOutcome = HandoffOutcome | 'pending';

export function connectExitCode(
  outcome: HandoffOutcome | null,
  awsOutcome: Extract<ConnectOutcome, 'connected' | 'pending'> | null
): ExitCode {
  if (outcome === 'timeout') return ExitCode.GENERAL;
  if (awsOutcome === 'pending') return ExitCode.PENDING;
  return ExitCode.SUCCESS;
}

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
): Promise<HandoffOutcome> {
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
      process.stderr.write(`✓ Connected: ${accountLabel(account)}\n`);
    }
    return 'connected';
  }
  process.stderr.write('Timed out waiting — the connection has not shown up yet. Check with `polylane cloud list`.\n');
  return 'timeout';
}

function accountLabel(account: CloudAccount): string {
  const detail = [account.account, account.region].filter(Boolean).join(', ');
  return `${account.alias || account.account}${detail ? ` (${detail})` : ''}`;
}

const AWS_WAIT_INTERVAL_MS = 5_000;
const AWS_SETTLE_TIMEOUT_MS = 2 * 60_000;
const AWS_CHECK_HINT = 'Check with `polylane cloud list`.';
const AWS_STILL_CONNECTING =
  'AWS is still connecting — the CloudFormation stack has not shown up yet.\n' +
  'Check later with `polylane cloud list`; the account appears there once the\n' +
  'stack finishes creating. If the stack failed or rolled back, your AWS\n' +
  'CloudFormation console shows the reason; fix it and re-run\n' +
  '`polylane cloud connect --provider aws`. Exiting 7 (pending) until then.';

export interface AwsStackWait {
  pending: () => boolean;
  flush: () => void;
  settle: () => Promise<Extract<ConnectOutcome, 'connected' | 'pending'>>;
}

// The picker flow hands the CloudFormation deploy to this instead of blocking
// on it: polling runs in the background while the user keeps connecting other
// clouds, flush() prints the "AWS connected" transition between prompts (never
// over one), and settle() ends the session with a short bounded foreground
// wait so a stack that is still deploying reports its state instead of
// holding the terminal for the full deploy.
export function startAwsStackWait(
  config: Config,
  check: () => Promise<CloudAccount[] | null>,
  opts: { settleTimeoutMs?: number; intervalMs?: number } = {}
): AwsStackWait {
  const intervalMs = opts.intervalMs ?? AWS_WAIT_INTERVAL_MS;
  const settleTimeoutMs = opts.settleTimeoutMs ?? AWS_SETTLE_TIMEOUT_MS;
  const background = startBackgroundCompletion(check, intervalMs);
  let reported: 'connected' | 'pending' | null = null;
  const reportConnected = (accounts: CloudAccount[]): 'connected' => {
    reported = 'connected';
    for (const account of accounts) {
      process.stderr.write(`✓ AWS connected: ${accountLabel(account)}\n`);
    }
    return 'connected';
  };
  return {
    pending: () => reported === null,
    flush: (): void => {
      if (reported !== null) return;
      const found = background.peek();
      if (found) reportConnected(found);
    },
    settle: async (): Promise<'connected' | 'pending'> => {
      if (reported !== null) return reported;
      background.stop();
      const already = background.peek();
      if (already) return reportConnected(already);
      const found = await waitForBrowserCompletion(config, check, {
        waitingFor: 'the CloudFormation stack to deploy (usually a few minutes)',
        interruptHint: AWS_CHECK_HINT,
        startHint: 'AWS: waiting for the CloudFormation stack to finish deploying.',
        timeoutMs: settleTimeoutMs,
        intervalMs,
      });
      if (found) return reportConnected(found);
      reported = 'pending';
      process.stderr.write(`${AWS_STILL_CONNECTING}\n`);
      return 'pending';
    },
  };
}

type ConnectResult = Awaited<ReturnType<PolylaneAPI['cloudAccountsConnect']>>;

function printConnectSuccess(config: Config, result: ConnectResult): void {
  if (config.output === 'json' || !('accounts' in result)) {
    formatOutput(config, result);
    return;
  }
  for (const account of result.accounts) {
    process.stderr.write(`✓ Connected: ${accountLabel(account)}\n`);
  }
  for (const failure of result.failures) {
    process.stderr.write(`Couldn't connect ${failure.account}: ${failure.message}\n`);
  }
}

const TURSO_ORGANIZATION_HINT =
  'List your organizations with `turso org list`, or check the switcher in the Turso dashboard (https://app.turso.tech).';

// A Turso platform API token carries the permissions of the account that
// minted it, so it can reach every organization that account belongs to. The
// API refuses to guess (400) when there is more than one; pick the
// organization here and retry instead of surfacing a dead end.
export async function connectTurso(
  config: Config,
  api: PolylaneAPI,
  body: Extract<ConnectBody, { provider: 'turso' }>
): Promise<typeof BACK | ConnectResult> {
  try {
    return await api.cloudAccountsConnect(body);
  } catch (err) {
    if (
      !isApiError(err) ||
      err.status !== 400 ||
      body.organization !== undefined ||
      !/multiple turso organizations/i.test(err.message)
    ) {
      throw err;
    }
    if (!isInteractive(config.nonInteractive)) {
      throw new CLIError(
        err.message,
        ExitCode.USAGE,
        `Pass --organization <slug>.\n${TURSO_ORGANIZATION_HINT}`
      );
    }
    note(`${err.message}\n${TURSO_ORGANIZATION_HINT}`, 'Turso organization');
    const picked = await promptTextOrBack(
      { nonInteractive: config.nonInteractive },
      'Turso organization slug',
      { validate: (v: string) => (v.trim() ? undefined : 'Required') }
    );
    if (picked === BACK) return BACK;
    return api.cloudAccountsConnect({ ...body, organization: picked.trim() });
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
): Promise<HandoffOutcome> {
  const baseline = config.dryRun ? null : await accountBaseline(api, workspaceId, provider);
  if (baseline && !reconnect && baseline.existing.length > 0) {
    printAlreadyConnected(config, name, baseline.existing);
    return 'connected';
  }
  const check = canWaitForBrowser(config) && baseline ? baseline.check : null;
  await openOrPrintInstallUrl(config, cliConnectUrl(config, provider, workspaceId), label, noBrowser);
  return confirmBrowserConnect(config, check, `${label} to connect`);
}

// Where to create the token when this terminal cannot open a browser. The
// pre-filled creation URL is ~13KB (the permission list rides in a query
// param), so it is never printed — the console's connect screen carries the
// same link, and the short dashboard URL covers doing it fully by hand.
const CLOUDFLARE_MANUAL_STEPS =
  'Create the token from any machine with a browser:\n' +
  '- Easiest: open your Polylane console > Settings > Clouds > Connect >\n' +
  '  Cloudflare — its create-token link opens Cloudflare with the read-only\n' +
  '  token pre-filled. Create it as-is.\n' +
  '- By hand: open https://dash.cloudflare.com/?to=/:account/api-tokens and\n' +
  '  create a custom token with Read access for the account and its zones.\n' +
  'Then come back and paste the token here.';

const CLOUDFLARE_HEADLESS_HINT =
  'Create a read-only token from your Polylane console (Settings > Clouds > Connect > Cloudflare — the create-token link comes pre-filled), then re-run:\n' +
  'polylane cloud connect --provider cloudflare --token <token>';

// Token creation happens in-flow: the CLI opens Cloudflare's account API
// token screen pre-filled with the read-only token, waits for the paste, and
// never routes through the docs site. secretStep is not reusable here because
// it prints its link everywhere it appears — this URL must only ever be
// handed to a browser.
function cloudflareTokenStep(
  config: Config,
  args: Record<string, unknown>,
  noBrowser: boolean,
  set: (value: string) => void
): WizardStep {
  return async () => {
    const fromFlag = getArgString(args, 'token');
    if (fromFlag !== undefined) {
      set(fromFlag);
      return SKIPPED;
    }
    if (!isInteractive(config.nonInteractive)) {
      throw new CLIError('Missing required flag: --token', ExitCode.USAGE, CLOUDFLARE_HEADLESS_HINT);
    }
    const ctx = { nonInteractive: config.nonInteractive };
    note(
      'Polylane connects to Cloudflare with a read-only account API token.\n' +
        'The CLI can open Cloudflare with the token pre-filled: create it as-is\n' +
        '(nothing to edit) and paste it here.\n' +
        'You must be a Super Administrator on the Cloudflare account.',
      'Cloudflare API token'
    );
    let openIt = !noBrowser;
    if (!noBrowser) {
      const answer = await promptConfirmOrBack(ctx, 'Open Cloudflare in your browser to create the token?', true);
      if (answer === BACK) return BACK;
      openIt = answer;
    }
    if (openIt) {
      process.stderr.write('Opening your browser to create the token… paste it here when done.\n');
      openBrowser(buildCloudflareTokenUrl({ readOnly: true }));
      // openBrowser is best-effort and the pre-filled URL must never be
      // printed, so a silent spawn failure would leave the paste prompt with
      // no way forward — always show the manual fallback too.
      note(CLOUDFLARE_MANUAL_STEPS, "If the browser didn't open");
    } else {
      note(CLOUDFLARE_MANUAL_STEPS, 'No browser on this machine');
    }
    const value = await promptPasswordOrBack(ctx, 'Cloudflare API token (paste it here)');
    if (value === BACK) return BACK;
    set(value);
    return;
  };
}

// Each wizard step can go back to the previous one; backing out of the first
// returns BACK to re-open provider selection. `background` is set by the
// interactive picker flow (the one the installer drives): AWS then returns an
// AwsStackWait instead of blocking on the CloudFormation deploy.
async function connectProvider(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string,
  provider: Provider,
  noBrowser: boolean,
  background: boolean
): Promise<typeof BACK | HandoffOutcome | AwsStackWait> {
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
  if (provider === 'turso') {
    let token = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'token',
        '--token',
        {
          message: 'Turso platform API token',
          instructions:
            'In Turso, open Account settings > API Tokens and mint a platform API token, or run "turso auth api-tokens mint polylane" from the Turso CLI. Platform API tokens are different from database auth tokens; they carry the permissions of the account that minted them, and Polylane only reads organization, group, and database metadata during sync.',
          link: 'https://app.turso.tech/settings/api-tokens',
          linkLabel: 'Create token',
        },
        (v) => {
          token = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    const organization = getArgString(args, 'organization');
    const result = await connectTurso(config, api, {
      workspaceId,
      provider: 'turso',
      token,
      ...(organization !== undefined ? { organization } : {}),
    });
    if (result === BACK) return BACK;
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
    let regions: string[] | null = null;
    let subscribeToAlarms = getArgBoolean(args, 'subscribeAlarms') === true;
    const ok = await runSteps([
      textStep(config, args, 'account', 'AWS account ID (12 digits)', '--account', (v) => {
        account = v;
      }),
      choiceStep(config, args, 'region', '--region', 'AWS regions to scan', AWS_REGIONS, (v) => {
        regions = parseAwsRegions(v);
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
      regions,
      ...(createMonitoringAlarms ? { createMonitoringAlarms } : {}),
      ...(subscribeToAlarms ? { subscribeToAlarms } : {}),
    };
  } else if (provider === 'cloudflare') {
    // Always read-only: that is what both console connect surfaces send, and
    // the pre-filled URL mints a token with every write downgraded to read. A
    // broader token pasted here would be stored under a read-only label it
    // does not have, and every write for the account would then be refused
    // with no way to re-enable it.
    let token = '';
    const ok = await runSteps([
      cloudflareTokenStep(config, args, noBrowser, (v) => {
        token = v;
      }),
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
  } else if (provider === 'railway') {
    // The console connects Railway via OAuth, but that flow is console-only
    // (hidden generate route + console callback), so the CLI takes the token
    // path the same API accepts.
    let token = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'token',
        '--token',
        {
          message: 'Railway token',
          instructions:
            'In Railway, open Account Settings > Tokens and create a token. Select your workspace to scope the token to it, or leave it unscoped for an account token that covers every workspace you can access. Railway tokens have no permission options. Polylane connects every workspace the token can reach (narrow it with --railway-workspace).',
          link: 'https://railway.com/account/tokens',
          linkLabel: 'Create Railway token',
        },
        (v) => {
          token = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    const railwayWorkspaceId = getArgString(args, 'railwayWorkspace');
    body = { workspaceId, provider: 'railway', token, ...(railwayWorkspaceId ? { railwayWorkspaceId } : {}) };
  } else if (provider === 'convex') {
    let token = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'token',
        '--token',
        {
          message: 'Convex team access token',
          instructions:
            'In the Convex dashboard, open Team Settings > Access Tokens and create an access token. A team access token is scoped to exactly one team, so one token connects one team. Project-scoped tokens and deploy keys are rejected. Polylane only reads projects and deployments during sync; it never queries your tables.',
          link: 'https://dashboard.convex.dev/',
          linkLabel: 'Open Convex dashboard',
        },
        (v) => {
          token = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { workspaceId, provider: 'convex', token };
  } else if (provider === 'clickhouse') {
    let keyId = '';
    let keySecret = '';
    const ok = await runSteps([
      secretStep(
        config,
        args,
        'keyId',
        '--key-id',
        {
          message: 'ClickHouse Cloud key ID',
          instructions:
            'In the ClickHouse Cloud console, pick your organization and go to Organization > API Keys, then create a new API key with the read-only Developer role: Polylane only reads during sync. An API key belongs to exactly one organization. You get a key ID and a key secret, shown only once.',
          link: 'https://console.clickhouse.cloud/organizations',
          linkLabel: 'Create API key',
        },
        (v) => {
          keyId = v;
        }
      ),
      secretStep(
        config,
        args,
        'keySecret',
        '--key-secret',
        {
          message: 'ClickHouse Cloud key secret',
          instructions: 'Paste the key secret that came with the key ID.',
          link: 'https://console.clickhouse.cloud/organizations',
          linkLabel: 'Open ClickHouse Cloud',
        },
        (v) => {
          keySecret = v;
        }
      ),
    ]);
    if (!ok) return BACK;
    body = { workspaceId, provider: 'clickhouse', keyId, keySecret };
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
  // Open it in the browser unless suppressed. In the picker flow the deploy
  // is watched in the background so the rest of the session isn't blocked;
  // an explicit --provider aws keeps the foreground wait for scripts.
  if (result.provider === 'aws') {
    await openOrPrintInstallUrl(config, result.url, 'the AWS CloudFormation stack', noBrowser);
    if (background && awsCheck) {
      process.stderr.write('\nAWS: CloudFormation stack creating — finish it in your browser.\n');
      if (!config.quiet) {
        process.stderr.write(`Polylane keeps checking in the background while you continue. ${AWS_CHECK_HINT}\n`);
      }
      return startAwsStackWait(config, awsCheck);
    }
    return confirmBrowserConnect(config, awsCheck, 'the CloudFormation stack to deploy (usually a few minutes)', {
      timeoutMs: 15 * 60_000,
      intervalMs: AWS_WAIT_INTERVAL_MS,
    });
  }

  // All other providers return { accounts, failures } synchronously.
  printConnectSuccess(config, result);
  return 'connected';
}

export const cloudConnectCommand: Command = {
  name: 'cloud connect',
  description: 'Connect a cloud account (AWS, Cloudflare, Vercel, Fly.io, Render, Railway, PlanetScale, Supabase, Modal, Convex, ClickHouse, Turso, Kubernetes)',
  operationId: 'cloud_accounts.connect',
  options: [
    {
      flag: '--provider <p>',
      description: `${PROVIDER_OPTIONS.map((o) => o.value).join(' | ')} (prompted if omitted)`,
      type: 'string',
    },
    // AWS
    { flag: '--account <id>', description: 'AWS 12-digit account ID', type: 'string' },
    { flag: '--region <regions>', description: 'AWS regions to scan, comma-separated (e.g. us-east-1,eu-west-1), or "all" for every enabled region', type: 'string' },
    { flag: '--create-alarms', description: 'AWS: create monitoring alarms', type: 'boolean' },
    { flag: '--subscribe-alarms', description: 'AWS: subscribe to existing CloudWatch alarms', type: 'boolean' },
    // Cloudflare / Fly / Railway / PlanetScale / Convex / Turso
    { flag: '--token <token>', description: 'Cloudflare API token, Fly.io token, Railway token, PlanetScale service token, Convex team access token, or Turso platform API token', type: 'string' },
    { flag: '--railway-workspace <id>', description: 'Railway: connect only this Railway workspace ID (default: every workspace the token can reach)', type: 'string' },
    // Retired in 0.2.16: Cloudflare now always connects read-only, which is
    // what anyone passing this flag was asking for. Accepted and ignored for
    // one release so existing scripts do not start exiting 2 on an unknown
    // flag — delete this entry in 0.3.0.
    { flag: '--read-only', description: 'Deprecated: Cloudflare connects read-only either way; accepted and ignored', type: 'boolean' },
    // PlanetScale / Modal
    { flag: '--token-id <id>', description: 'PlanetScale service token ID, or Modal token ID', type: 'string' },
    { flag: '--token-secret <secret>', description: 'Modal token secret', type: 'string' },
    { flag: '--organization <org>', description: 'PlanetScale organization, or Turso organization slug', type: 'string' },
    // Render
    { flag: '--api-key <key>', description: 'Render API key', type: 'string' },
    // ClickHouse
    { flag: '--key-id <id>', description: 'ClickHouse Cloud API key ID', type: 'string' },
    { flag: '--key-secret <secret>', description: 'ClickHouse Cloud API key secret', type: 'string' },
    { flag: '--no-browser', description: 'AWS / Vercel / PlanetScale / Supabase: print the URL instead of opening it; Cloudflare: show manual token-creation steps instead of opening the browser', type: 'boolean' },
    { flag: '--reconnect', description: 'AWS / Vercel / PlanetScale / Supabase / Kubernetes: run the connect flow even when the provider is already connected', type: 'boolean' },
  ],
  examples: [
    'polylane cloud connect',
    'polylane cloud connect --provider vercel',
    'polylane cloud connect --provider vercel --reconnect',
    'polylane cloud connect --provider cloudflare --token <token>',
    'polylane cloud connect --provider aws --account 123456789012 --region us-east-1,eu-west-1 --subscribe-alarms',
    'polylane cloud connect --provider aws --account 123456789012 --region all',
    'polylane cloud connect --provider render --api-key <key>',
    'polylane cloud connect --provider railway --token <token>',
    'polylane cloud connect --provider supabase',
    'polylane cloud connect --provider planetscale --token-id <id> --token <token> --organization <org>',
    'polylane cloud connect --provider modal --token-id ak-... --token-secret as-...',
    'polylane cloud connect --provider convex --token <token>',
    'polylane cloud connect --provider clickhouse --key-id <id> --key-secret <secret>',
    'polylane cloud connect --provider turso --token <token>',
    'polylane cloud connect --provider turso --token <token> --organization <slug>',
    'polylane cloud connect --provider kubernetes',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const noBrowser = getArgBoolean(args, 'noBrowser') === true;
    const api = new PolylaneAPI(config);
    const providerFromFlag = getArgString(args, 'provider') !== undefined;
    const interactivePicker = !providerFromFlag && isInteractive(config.nonInteractive);

    // Provider selection restarts whenever the user backs out of the first
    // step of the chosen flow, so nothing is committed until a flow completes.
    // While an AWS CloudFormation deploy runs in the background the picker
    // stays open so other clouds can connect meanwhile; its transitions are
    // flushed between prompts and the session settles them before it ends.
    let awsWait: AwsStackWait | null = null;
    for (;;) {
      awsWait?.flush();
      const exitLabel: string = awsWait !== null && awsWait.pending() ? 'Done' : 'Cancel';
      const provider: Provider | typeof BACK =
        !interactivePicker
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
              exitLabel
            );
      if (provider === BACK) break;
      if (provider === 'aws' && awsWait?.pending()) {
        process.stderr.write('AWS: still waiting for the CloudFormation stack — connect another cloud or pick Done.\n');
        continue;
      }
      const outcome = await connectProvider(config, api, args, workspaceId, provider, noBrowser, interactivePicker);
      if (outcome === BACK) {
        if (providerFromFlag) break;
        continue;
      }
      if (typeof outcome !== 'string') {
        awsWait = outcome;
        continue;
      }
      const awsOutcome = awsWait ? await awsWait.settle() : null;
      process.exitCode = connectExitCode(outcome, awsOutcome);
      return;
    }
    if (awsWait) {
      process.exitCode = connectExitCode(null, await awsWait.settle());
      return;
    }
    cancel('Nothing connected.');
  },
};
