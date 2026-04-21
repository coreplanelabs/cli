import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import { readCredentials, deleteCredentials } from '../../auth/credentials';
import { revokeToken } from '../../auth/oauth';
import { loadConfigFile, replaceConfigFile } from '../../config/loader';
import { promptConfirm } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';

export const authLogoutCommand: Command = {
  name: 'auth logout',
  description: 'Clear local credentials',
  operationId: 'auth.logout',
  options: [
    { flag: '--yes', description: 'Skip confirmation prompt', type: 'boolean' },
  ],
  async execute(config: Config, flags: GlobalFlags, args: Record<string, unknown>): Promise<void> {
    const skipConfirm = args.yes === true;

    if (!skipConfirm && isInteractive(config.nonInteractive)) {
      const ok = await promptConfirm(
        { nonInteractive: config.nonInteractive },
        'Remove local credentials?',
        true
      );
      if (!ok) {
        process.stderr.write('Cancelled\n');
        return;
      }
    }

    if (config.dryRun) {
      process.stderr.write('[dry-run] Would delete credentials and clear api_key from config\n');
      return;
    }

    const cred = readCredentials();
    if (cred) {
      await revokeToken(config, cred.accessToken);
      deleteCredentials();
      process.stderr.write('OAuth credentials revoked and removed\n');
    }

    const existing = loadConfigFile();
    if (existing?.api_key) {
      const next = { ...existing };
      delete next.api_key;
      replaceConfigFile(next);
      process.stderr.write('API key cleared from config file\n');
    }

    process.stderr.write('Logged out\n');

    void flags;
  },
};
