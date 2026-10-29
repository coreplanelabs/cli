import { randomUUID } from 'node:crypto';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import type { GcpConnectionRequest } from '../../generated/types';
import { formatOutput } from '../../output/formatter';
import { Spinner } from '../../output/progress';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { isInteractive } from '../../utils/env';
import { BACK, note, promptConfirmOrBack, promptTextOrBack } from '../../utils/prompt';
import { getArgBoolean, getArgString, runSteps, SKIPPED, canWaitForBrowser, scopedSigint } from '../helpers';

// Same patterns the API validates against, so a typo is a usage error before
// a request is prepared.
const GCP_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const GCP_PROJECT_NUMBER = /^\d{6,20}$/;
const GCP_REQUEST_ID = /^gcpconn_[0-9a-z]{24}$/;

const PROJECT_ID_HINT = 'Use the project ID, such as my-production-project, rather than its display name.';
const PROJECT_NUMBER_HINT =
  'Find the numeric project number beside the project ID in Google Cloud project settings, or run `gcloud projects describe <project-id> --format="value(projectNumber)"`.';

// The server retries propagation for up to 10 minutes and answers 202 while
// it does; past that it throws the real error. The CLI polls a little longer
// so the server's verdict, not the CLI's clock, ends the wait.
const ACTIVATE_INTERVAL_MS = 5_000;
const ACTIVATE_TIMEOUT_MS = 12 * 60_000;

export type GcpOutcome = 'connected' | 'timeout' | 'pending';

export function parseGcpProjectId(value: string): string {
  const id = value.trim();
  if (!GCP_PROJECT_ID.test(id)) {
    throw new CLIError(`Invalid Google Cloud project ID: "${value}"`, ExitCode.USAGE, PROJECT_ID_HINT);
  }
  return id;
}

export function parseGcpProjectNumber(value: string): string {
  const number = value.trim();
  if (!GCP_PROJECT_NUMBER.test(number)) {
    throw new CLIError(`Invalid Google Cloud project number: "${value}"`, ExitCode.USAGE, PROJECT_NUMBER_HINT);
  }
  return number;
}

export function parseGcpRequestId(value: string): string {
  const id = value.trim();
  if (!GCP_REQUEST_ID.test(id)) {
    throw new CLIError(
      `Invalid Google Cloud connection request ID: "${value}"`,
      ExitCode.USAGE,
      'Pass the gcpconn_... ID printed when the setup was prepared.'
    );
  }
  return id;
}

export function gcpResumeCommand(requestId: string, projectNumber: string): string {
  return `polylane cloud connect --provider gcp --request ${requestId} --project-number ${projectNumber}`;
}

function validatorFor(parse: (v: string) => string): (v: string) => string | undefined {
  return (v: string) => {
    try {
      parse(v);
      return undefined;
    } catch (err) {
      return err instanceof CLIError && err.hint ? err.hint : 'Invalid value';
    }
  };
}

function valueStep(
  config: Config,
  args: Record<string, unknown>,
  key: string,
  flag: string,
  message: string,
  placeholder: string,
  parse: (v: string) => string,
  hint: string,
  set: (value: string) => void
): () => Promise<typeof BACK | typeof SKIPPED | void> {
  return async () => {
    const fromFlag = getArgString(args, key);
    if (fromFlag !== undefined) {
      set(parse(fromFlag));
      return SKIPPED;
    }
    if (!isInteractive(config.nonInteractive)) {
      throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE, hint);
    }
    const value = await promptTextOrBack({ nonInteractive: config.nonInteractive }, message, {
      placeholder,
      validate: validatorFor(parse),
    });
    if (value === BACK) return BACK;
    set(parse(value));
    return;
  };
}

// Verify with the API's poll mode: 202 means Google access is still
// propagating, so re-send until the account registers. Errors are not
// swallowed — after its retry window the server answers with the real reason.
async function activate(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string,
  requestId: string,
  projectNumber: string
): Promise<string | null> {
  const spinner = new Spinner('Verifying the Google Cloud connection… (Ctrl+C to stop waiting)');
  const restoreSigint = scopedSigint(() => {
    spinner.stop(`Stopped waiting. Resume with: ${gcpResumeCommand(requestId, projectNumber)}`);
    process.exit(0);
  });
  if (!config.quiet && config.output !== 'json') spinner.start();
  try {
    const deadline = Date.now() + ACTIVATE_TIMEOUT_MS;
    for (;;) {
      const result = await api.cloudAccountsGcpActivate({ workspaceId, requestId, projectNumber, verificationMode: 'poll' });
      if (result.provisioningStatus === 'registered') {
        spinner.stop();
        return result.cloudAccountId;
      }
      if (Date.now() >= deadline) {
        spinner.stop();
        return null;
      }
      await new Promise((r) => setTimeout(r, ACTIVATE_INTERVAL_MS));
    }
  } catch (err) {
    spinner.fail();
    throw err;
  } finally {
    restoreSigint();
  }
}

async function finish(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string,
  request: Pick<GcpConnectionRequest, 'requestId' | 'projectId'>,
  projectNumber: string
): Promise<GcpOutcome> {
  const cloudAccountId = await activate(config, api, workspaceId, request.requestId, projectNumber);
  if (cloudAccountId === null) {
    process.stderr.write(
      'Timed out waiting for Google Cloud access to propagate.\n' +
        `Retry: ${gcpResumeCommand(request.requestId, projectNumber)}\n`
    );
    return 'timeout';
  }
  if (config.output === 'json') {
    formatOutput(config, await api.cloudAccountsGet(workspaceId, cloudAccountId));
  } else {
    process.stderr.write(`✓ Connected: ${request.projectId} (${cloudAccountId})\n`);
    if (!config.quiet) {
      process.stderr.write(`Initial inventory may still be syncing. Follow it with \`polylane cloud show ${cloudAccountId}\`.\n`);
    }
  }
  return 'connected';
}

// Resume a request prepared earlier: re-running the setup script is not
// needed, only the verification.
async function resume(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string,
  requestId: string
): Promise<typeof BACK | GcpOutcome> {
  const request = await api.cloudAccountsGcpRequestsGet(workspaceId, requestId);
  if (request.status === 'expired' || request.status === 'revoked') {
    throw new CLIError(
      `Google Cloud connection request ${requestId} is ${request.status}`,
      ExitCode.USAGE,
      'Remove its Google deployment (Infrastructure Manager > Deployments), then prepare a new one:\n' +
        `polylane cloud connect --provider gcp --project-id ${request.projectId}`
    );
  }
  // A request that was verified once remembers its project number; the flag
  // still wins so a typo'd number can be corrected.
  let projectNumber = request.projectNumber ?? '';
  if (getArgString(args, 'projectNumber') !== undefined || projectNumber === '') {
    const ok = await runSteps([
      valueStep(
        config,
        args,
        'projectNumber',
        '--project-number',
        'Google Cloud project number',
        '123456789012',
        parseGcpProjectNumber,
        PROJECT_NUMBER_HINT,
        (v) => {
          projectNumber = v;
        }
      ),
    ]);
    if (!ok) return BACK;
  }
  return finish(config, api, workspaceId, request, projectNumber);
}

export async function connectGcp(
  config: Config,
  api: PolylaneAPI,
  args: Record<string, unknown>,
  workspaceId: string
): Promise<typeof BACK | GcpOutcome> {
  const requestFlag = getArgString(args, 'request');
  if (requestFlag !== undefined) {
    return resume(config, api, args, workspaceId, parseGcpRequestId(requestFlag));
  }

  let projectId = '';
  let projectNumber = '';
  let investigateAlerts = getArgBoolean(args, 'noInvestigateAlerts') !== true;
  const ok = await runSteps([
    valueStep(
      config,
      args,
      'projectId',
      '--project-id',
      'Google Cloud project ID',
      'my-production-project',
      parseGcpProjectId,
      PROJECT_ID_HINT,
      (v) => {
        projectId = v;
      }
    ),
    valueStep(
      config,
      args,
      'projectNumber',
      '--project-number',
      'Google Cloud project number',
      '123456789012',
      parseGcpProjectNumber,
      PROJECT_NUMBER_HINT,
      (v) => {
        projectNumber = v;
      }
    ),
    async () => {
      if (
        getArgBoolean(args, 'noInvestigateAlerts') === true ||
        getArgString(args, 'projectId') !== undefined ||
        !isInteractive(config.nonInteractive)
      ) {
        return SKIPPED;
      }
      const answer = await promptConfirmOrBack(
        { nonInteractive: config.nonInteractive },
        'Investigate alerts? (Polylane investigates alerts from Cloud Monitoring policies in this project when they fire)',
        true
      );
      if (answer === BACK) return BACK;
      investigateAlerts = answer;
      return;
    },
  ]);
  if (!ok) return BACK;

  const request = await api.cloudAccountsGcpRequestsCreate({
    workspaceId,
    projectId,
    investigateAlerts,
    idempotencyKey: randomUUID(),
  });
  const setup = await api.cloudAccountsGcpRequestsSetup(workspaceId, request.requestId);
  const resumeCommand = gcpResumeCommand(request.requestId, projectNumber);

  if (config.output === 'json') {
    formatOutput(config, {
      requestId: request.requestId,
      projectId: request.projectId,
      projectNumber,
      status: request.status,
      expiresAt: request.expiresAt,
      commands: setup.commands,
      consoleUrl: setup.consoleUrl,
      next: resumeCommand,
    });
    return 'pending';
  }

  if (!config.quiet) {
    note(
      [
        'Setup creates a dedicated reader identity and event delivery resources in your project.',
        'A project administrator runs the script below in Google Cloud Shell or a terminal signed in with gcloud.',
        'Your project and workspace are already filled in. Setup takes a few minutes.',
        `Deployment progress: ${setup.consoleUrl}`,
        `The request is saved until ${request.expiresAt}.`,
      ].join('\n'),
      'Connect Google Cloud'
    );
  }
  process.stdout.write(setup.commands.trimEnd() + '\n');

  if (!canWaitForBrowser(config)) {
    process.stderr.write(`\nAfter the script finishes, verify and connect with:\n${resumeCommand}\n`);
    return 'pending';
  }
  const ready = await promptConfirmOrBack(
    { nonInteractive: config.nonInteractive },
    'Has the setup script finished? (verify and connect now)',
    true
  );
  if (ready !== true) {
    process.stderr.write(`Your setup is saved. After the script finishes, run:\n${resumeCommand}\n`);
    return 'pending';
  }
  return finish(config, api, workspaceId, request, projectNumber);
}
