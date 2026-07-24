import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const integrationShowCommand: Command = {
  name: 'integration show',
  description: 'Show a configured integration',
  operationId: 'integrations.list',
  positional: [{ name: 'integration-id', description: 'Integration ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'integration-id');
    const api = new PolylaneAPI(config);
    // There is no dedicated integrations.get; fetch via list+filter on id.
    const result = await api.integrationsList(workspaceId, { id, perPage: 1 });
    const integration = result.items[0];
    if (!integration) {
      throw new CLIError(
        `No integration with ID ${id}`,
        ExitCode.GENERAL,
        'List integrations with `polylane integration list`'
      );
    }
    formatOutput(config, integration);
  },
};
