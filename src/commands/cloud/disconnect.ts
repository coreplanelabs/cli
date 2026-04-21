import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgBoolean } from '../helpers';
import { promptConfirm } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const cloudDisconnectCommand: Command = {
  name: 'cloud disconnect',
  description: 'Disconnect a cloud account',
  operationId: 'cloud_accounts.disconnect',
  positional: [{ name: 'account-id', description: 'Cloud account ID' }],
  options: [{ flag: '--yes', description: 'Skip confirmation', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'account-id');
    const yes = getArgBoolean(args, 'yes') === true;
    if (!yes) {
      if (!isInteractive(config.nonInteractive)) {
        throw new CLIError('Refusing to disconnect without --yes in non-interactive mode', ExitCode.USAGE);
      }
      const confirmed = await promptConfirm(
        { nonInteractive: config.nonInteractive },
        `Disconnect cloud account ${id}?`,
        false
      );
      if (!confirmed) {
        process.stderr.write('Cancelled\n');
        return;
      }
    }
    const api = new NominalAPI(config);
    const result = await api.cloudAccountsDisconnect(workspaceId, id);
    formatOutput(config, result);
  },
};
