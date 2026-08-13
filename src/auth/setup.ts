import type { Config } from '../config/schema';
import { tryResolveCredential } from './resolver';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { isInteractive } from '../utils/env';

export async function ensureAuth(config: Config): Promise<void> {
  const cred = await tryResolveCredential(config);
  if (cred) return;

  if (!isInteractive(config.nonInteractive)) {
    throw new CLIError(
      'Not signed in.',
      ExitCode.AUTH,
      'Run `polylane auth login`'
    );
  }

  throw new CLIError(
    'Not signed in.',
    ExitCode.AUTH,
    'Run `polylane auth login`'
  );
}
