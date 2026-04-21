import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const integrationShowCommand: Command = {
  name: 'integration show',
  description: 'Show a configured integration',
  operationId: 'integrations.list',
  positional: [{ name: 'integration-id', description: 'Integration ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'integration-id');
    const api = new NominalAPI(config);
    // There is no dedicated integrations.get; fetch via list+filter on id.
    const result = await api.integrationsList(workspaceId, { id, perPage: 1 });
    const integration = result.items[0];
    if (!integration) {
      process.stderr.write(`No integration with id ${id}\n`);
      process.exit(1);
    }
    formatOutput(config, integration);
  },
};
