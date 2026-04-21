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
      'Not authenticated',
      ExitCode.AUTH,
      'Run `nominal auth login` to authenticate'
    );
  }

  throw new CLIError(
    'Not authenticated',
    ExitCode.AUTH,
    'Run `nominal auth login` to authenticate'
  );
}
