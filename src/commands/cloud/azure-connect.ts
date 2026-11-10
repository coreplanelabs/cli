import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { Spinner } from '../../output/progress';
import { CLIError } from '../../errors/base';
import { ApiError } from '../../errors/api';
import { ExitCode } from '../../errors/codes';
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';
import { BACK, note, promptConfirmOrBack } from '../../utils/prompt';
import { getArgBoolean, getArgString, runSteps, SKIPPED, scopedSigint } from '../helpers';

export type AzureConnectionRequest = Awaited<ReturnType<PolylaneAPI['cloudAccountsAzureRequestsGet']>>;
export type AzureOutcome = 'connected' | 'timeout' | 'pending';

const AZURE_REQUEST_ID = /^azureconn_[0-9a-z]{24}$/;

export const AZURE_POLL_INTERVAL_MS = 5_000;
export const AZURE_POLL_TIMEOUT_MS = 15 * 60_000;

export function parseAzureRequestId(value: string): string {
  const id = value.trim();
  if (!AZURE_REQUEST_ID.test(id)) {
    throw new CLIError(
      `Invalid Azure connection request ID: "${value}"`,
      ExitCode.USAGE,
      'Pass the azureconn_... ID printed when the connection started.'
    );
  }
  return id;
}

// The request belongs to one workspace, so the command names it: a request
// started with --workspace must not resume against the configured default.
export function azureResumeCommand(workspaceId: string, requestId: string): string {
  return `polylane --workspace ${workspaceId} cloud connect --provider azure --request ${requestId}`;
}

function startAgainCommand(workspaceId: string): string {
  return `polylane --workspace ${workspaceId} cloud connect --provider azure`;
}

export function isAzureRequestConnected(request: AzureConnectionRequest): boolean {
  return request.status === 'active' && request.completedAt !== null;
}

function endedError(workspaceId: string, request: AzureConnectionRequest): CLIError {
  return new CLIError(
    `Azure connection request ${request.requestId} is ${request.status}`,
    ExitCode.GENERAL,
    `Start a new connection:\n${startAgainCommand(workspaceId)}`
  );
}

// A dropped connection, a slow read or a server error does not end the request, so the
// wait reads again on the next interval instead of giving up.
export function isTransientAzurePollError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500 || err.status === 429;
  if (err instanceof CLIError) return err.exitCode === ExitCode.NETWORK || err.exitCode === ExitCode.TIMEOUT;
  return err instanceof TypeError;
}

export type AzurePollResult = { kind: 'connected'; request: AzureConnectionRequest } | { kind: 'timeout' };

// Each read also asks the API to finish the connection once Azure has
// delegated the subscription, so the poll drives activation forward.
export async function pollAzureRequest(
  api: Pick<PolylaneAPI, 'cloudAccountsAzureRequestsGet'>,
  workspaceId: string,
  requestId: string,
  deps: {
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {}
): Promise<AzurePollResult> {
  const intervalMs = deps.intervalMs ?? AZURE_POLL_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? AZURE_POLL_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + timeoutMs;
  for (;;) {
    let request: AzureConnectionRequest | null = null;
    try {
      request = await api.cloudAccountsAzureRequestsGet(workspaceId, requestId);
    } catch (err) {
      if (!isTransientAzurePollError(err)) throw err;
    }
    if (request && isAzureRequestConnected(request)) return { kind: 'connected', request };
    if (request && (request.status === 'cancelled' || request.status === 'expired')) throw endedError(workspaceId, request);
    if (now() >= deadline) return { kind: 'timeout' };
    await sleep(intervalMs);
  }
}

async function printConnected(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string,
  request: AzureConnectionRequest
): Promise<AzureOutcome> {
  const cloudAccountId = request.cloudAccountId ?? '';
  if (config.output === 'json') {
    formatOutput(config, cloudAccountId ? await api.cloudAccountsGet(workspaceId, cloudAccountId) : request);
    return 'connected';
  }
  const subscription = request.subscriptionId ? `Azure subscription ${request.subscriptionId}` : 'Azure subscription';
  process.stderr.write(`✓ Connected: ${subscription}${cloudAccountId ? ` (${cloudAccountId})` : ''}\n`);
  if (!config.quiet && cloudAccountId) {
    process.stderr.write(`The first inventory sync can take a few minutes. Follow it with \`polylane cloud show ${cloudAccountId}\`.\n`);
  }
  return 'connected';
}

export async function cancelAzureRequest(
  api: Pick<PolylaneAPI, 'cloudAccountsAzureRequestsCancel'>,
  workspaceId: string,
  requestId: string
): Promise<boolean> {
  process.stderr.write('Cancelling the Azure connection request…\n');
  try {
    const request = await api.cloudAccountsAzureRequestsCancel(workspaceId, requestId);
    // The API cancels only a pending request: one that Azure finished between
    // two reads comes back active, so the message follows the returned status.
    if (request.status === 'active') {
      process.stderr.write(
        `The Azure deployment finished before the cancel, so the request was not cancelled. To see the connection, run:\n${azureResumeCommand(workspaceId, requestId)}\n`
      );
      return false;
    }
    process.stderr.write(`Cancelled. To connect Azure later, run:\n${startAgainCommand(workspaceId)}\n`);
    return true;
  } catch {
    process.stderr.write(
      `The request could not be cancelled. It expires on its own. To check it, run:\n${azureResumeCommand(workspaceId, requestId)}\n`
    );
    return false;
  }
}

async function cancelOnInterrupt(api: PolylaneAPI, workspaceId: string, requestId: string): Promise<never> {
  await cancelAzureRequest(api, workspaceId, requestId);
  process.exit(130);
}

// An interactive wait shows a spinner, and Ctrl+C cancels the request so a
// deployment created later cannot connect a subscription nobody waits for.
// A non-interactive wait polls quietly.
async function waitForConnection(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string,
  requestId: string
): Promise<AzureOutcome> {
  const interactive = isInteractive(config.nonInteractive);
  const spinner = new Spinner('Waiting for the Azure deployment to finish… (Ctrl+C to cancel)');
  const restoreSigint = scopedSigint(() => {
    spinner.stop();
    void cancelOnInterrupt(api, workspaceId, requestId);
  });
  if (interactive && !config.quiet) spinner.start();
  try {
    const result = await pollAzureRequest(api, workspaceId, requestId);
    spinner.stop();
    if (result.kind === 'connected') return await printConnected(config, api, workspaceId, result.request);
    process.stderr.write(
      'The Azure deployment has not connected yet. If it is still running, check again with:\n' +
        `${azureResumeCommand(workspaceId, requestId)}\n`
    );
    return 'timeout';
  } catch (err) {
    spinner.fail();
    throw err;
  } finally {
    restoreSigint();
  }
}

async function resume(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string,
  requestId: string
): Promise<AzureOutcome> {
  const request = await api.cloudAccountsAzureRequestsGet(workspaceId, requestId);
  if (isAzureRequestConnected(request)) return printConnected(config, api, workspaceId, request);
  if (request.status === 'cancelled' || request.status === 'expired') throw endedError(workspaceId, request);
  if (getArgBoolean(args, 'noWait') === true || config.output === 'json' || config.dryRun) {
    if (config.output === 'json') {
      formatOutput(config, { requestId, status: request.status, next: azureResumeCommand(workspaceId, requestId) });
    } else {
      process.stderr.write(`The Azure connection is not complete yet. Check again with:\n${azureResumeCommand(workspaceId, requestId)}\n`);
    }
    return 'pending';
  }
  return waitForConnection(config, api, workspaceId, requestId);
}

export async function connectAzure(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string,
  noBrowser: boolean
): Promise<typeof BACK | AzureOutcome> {
  const requestFlag = getArgString(args, 'request');
  if (requestFlag !== undefined) {
    return resume(config, api, args, workspaceId, parseAzureRequestId(requestFlag));
  }

  let createMonitoringAlarms = getArgBoolean(args, 'noAlertRules') !== true;
  const ok = await runSteps([
    async () => {
      if (getArgBoolean(args, 'noAlertRules') === true || !isInteractive(config.nonInteractive)) return SKIPPED;
      const answer = await promptConfirmOrBack(
        { nonInteractive: config.nonInteractive },
        'Allow Polylane to create Azure Monitor alert rules?',
        true
      );
      if (answer === BACK) return BACK;
      createMonitoringAlarms = answer;
      return;
    },
  ]);
  if (!ok) return BACK;

  const result = await api.cloudAccountsConnect({ workspaceId, provider: 'azure', createMonitoringAlarms });
  if (config.dryRun) return 'pending';
  if (result.provider !== 'azure') {
    throw new CLIError('Unexpected response from the Azure connect endpoint', ExitCode.GENERAL);
  }
  const { request, deployUrl } = result;
  const resumeCommand = azureResumeCommand(workspaceId, request.requestId);
  const noWait = getArgBoolean(args, 'noWait') === true;

  if (config.output === 'json') {
    formatOutput(config, {
      requestId: request.requestId,
      status: request.status,
      createMonitoringAlarms: request.createMonitoringAlarms,
      expiresAt: request.expiresAt,
      deployUrl,
      next: resumeCommand,
    });
    return 'pending';
  }

  const shouldOpen = !noBrowser && isInteractive(config.nonInteractive);
  if (!config.quiet) {
    note(
      [
        'A deployment in the Azure portal gives Polylane read access to one subscription through Azure Lighthouse.',
        shouldOpen ? 'The Azure portal opens in your browser. Then:' : 'Open the URL below in a browser. Then:',
        '1. Sign in as an Owner of the subscription.',
        '2. Select the subscription to connect.',
        '3. Select Review + create, then Create.',
        `The request stays open until ${request.expiresAt}.`,
      ].join('\n'),
      'Connect Azure'
    );
    if (shouldOpen) process.stderr.write("If the browser does not open, use this URL:\n");
  }
  process.stdout.write(deployUrl + '\n');
  if (shouldOpen) openBrowser(deployUrl);

  if (noWait) {
    process.stderr.write(`\nRequest ${request.requestId}. After the deployment finishes, check the connection with:\n${resumeCommand}\n`);
    return 'pending';
  }
  return waitForConnection(config, api, workspaceId, request.requestId);
}
