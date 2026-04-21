import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const cloudSyncCommand: Command = {
  name: 'cloud sync',
  description: 'Trigger a sync of a connected cloud account',
  operationId: 'cloud_accounts.sync',
  positional: [{ name: 'account-id', description: 'Cloud account ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'account-id');
    const api = new NominalAPI(config);
    const result = await api.cloudAccountsSync({ workspaceId, id });
    formatOutput(config, result);
  },
};
