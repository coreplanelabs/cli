import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const integrationValidateCommand: Command = {
  name: 'integration validate',
  description: 'Validate the saved credentials for an integration',
  operationId: 'integrations.validate_credentials',
  positional: [{ name: 'integration-id', description: 'Integration ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'integration-id');
    const api = new NominalAPI(config);
    const result = await api.integrationsValidateCredentials({ workspaceId, id });
    formatOutput(config, result);
  },
};
