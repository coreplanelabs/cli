import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { readCredentials } from '../../auth/credentials';
import { refreshToken } from '../../auth/refresh';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { formatSingle } from '../../output/formatter';

export const authRefreshCommand: Command = {
  name: 'auth refresh',
  description: 'Refresh OAuth access token',
  operationId: 'auth.refresh',
  async execute(config: Config): Promise<void> {
    const cred = readCredentials();
    if (!cred) {
      throw new CLIError(
        'No OAuth credentials found',
        ExitCode.AUTH,
        'Run `nominal auth login` to authenticate'
      );
    }
    if (config.dryRun) {
      process.stderr.write('[dry-run] Would refresh token\n');
      return;
    }
    const refreshed = await refreshToken(config, cred);
    formatSingle(config, {
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    });
  },
};
