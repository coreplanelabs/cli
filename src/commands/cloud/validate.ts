import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const cloudValidateCommand: Command = {
  name: 'cloud validate',
  description: 'Validate the saved credentials for a cloud account',
  operationId: 'cloud_accounts.validate_credentials',
  positional: [{ name: 'account-id', description: 'Cloud account ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'account-id');
    const api = new NominalAPI(config);
    const result = await api.cloudAccountsValidateCredentials({ workspaceId, id });
    formatOutput(config, result);
  },
};
