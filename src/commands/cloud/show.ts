import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const cloudShowCommand: Command = {
  name: 'cloud show',
  description: 'Show a connected cloud account',
  operationId: 'cloud_accounts.get',
  positional: [{ name: 'account-id', description: 'Cloud account ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'account-id');
    const api = new NominalAPI(config);
    const account = await api.cloudAccountsGet(workspaceId, id);
    formatOutput(config, account);
  },
};
