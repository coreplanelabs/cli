import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { tryResolveCredential } from '../../auth/resolver';
import {
  consumeOnboardingRunFile,
  resolveOnboardingRunId,
  sanitizeOnboardingRunId,
} from '../../auth/onboarding-run';
import { requestJson } from '../../client/http';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { formatOutput } from '../../output/formatter';
import { getPositional } from '../helpers';

export interface BindRunResult {
  bound: boolean;
  runId: string | null;
}

// Binds an installer-minted onboarding run to the account already signed in on
// this machine. The fresh-login flows carry the run id on the OAuth URLs / signup
// body, but a machine with existing credentials never enters those flows, so the
// installer (and a bare re-login) call this instead. Never a login prompt: the
// caller decides whether being signed out is a problem.
//
// `apiKey` pins the request to that key instead of whatever `resolveCredential`
// would pick: stored OAuth credentials outrank a config-file or prompted key
// there, so an API-key login on a machine with an older OAuth session would
// otherwise attribute the run to the OAuth account, not the key just validated.
export async function bindOnboardingRun(
  config: Config,
  runId: string | null,
  apiKey?: string
): Promise<BindRunResult> {
  if (!runId) {
    process.stderr.write('No onboarding run to bind (POLYLANE_ONBOARDING_RUN unset, no ~/.polylane/onboarding-run).\n');
    return { bound: false, runId: null };
  }
  if (!apiKey && !(await tryResolveCredential(config))) {
    process.stderr.write(`Not signed in; onboarding run ${runId} left unbound.\n`);
    return { bound: false, runId };
  }
  // The route takes no input, but the API edge answers a body-less POST without
  // a JSON content type with a bare 403 before the worker sees it (nominal#1575).
  // `request` sets Content-Type only when a body is present, so send `{}`.
  const result = await requestJson<{ bound: boolean }>(config, {
    method: 'POST',
    url: `/v1/auth/onboarding_runs/${runId}/bind`,
    body: {},
    ...(apiKey ? { headers: { 'x-api-key': apiKey }, noAuth: true } : {}),
  });
  const bound = result.bound === true;
  // The file is one-shot: spent once the server has joined the run to the account.
  // Under --dry-run nothing was sent, so it must survive for the real call.
  if (bound && !config.dryRun) consumeOnboardingRunFile();
  return { bound, runId };
}

export const authBindRunCommand: Command = {
  name: 'auth bind-run',
  description: 'Bind an installer onboarding run to the signed-in account',
  operationId: 'auth.bindOnboardingRun',
  positional: [{ name: 'run-id', description: 'Onboarding run UUID (default: POLYLANE_ONBOARDING_RUN, then ~/.polylane/onboarding-run)' }],
  examples: ['polylane auth bind-run', 'polylane auth bind-run 5f0c9a4e-2b7d-4f11-9c3a-8e6b2d1a7c4f'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const explicit = getPositional(args, 0);
    let runId: string | null;
    if (explicit !== undefined) {
      runId = sanitizeOnboardingRunId(explicit);
      if (!runId) {
        throw new CLIError(`Onboarding run id must be a UUID: ${explicit}`, ExitCode.USAGE, 'polylane auth bind-run <uuid>');
      }
    } else {
      runId = resolveOnboardingRunId();
    }
    const result = await bindOnboardingRun(config, runId);
    if (config.output === 'json') {
      formatOutput(config, result);
      return;
    }
    if (result.bound) process.stdout.write(`Bound onboarding run ${result.runId} to the signed-in account\n`);
  },
};
