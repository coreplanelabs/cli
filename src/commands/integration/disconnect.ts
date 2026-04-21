import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgBoolean } from '../helpers';
import { promptConfirm } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const integrationDisconnectCommand: Command = {
  name: 'integration disconnect',
  description: 'Remove a configured integration',
  operationId: 'integrations.delete',
  positional: [{ name: 'integration-id', description: 'Integration ID' }],
  options: [{ flag: '--yes', description: 'Skip confirmation', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'integration-id');
    const yes = getArgBoolean(args, 'yes') === true;
    if (!yes) {
      if (!isInteractive(config.nonInteractive)) {
        throw new CLIError('Refusing to disconnect without --yes in non-interactive mode', ExitCode.USAGE);
      }
      const confirmed = await promptConfirm(
        { nonInteractive: config.nonInteractive },
        `Disconnect integration ${id}?`,
        false
      );
      if (!confirmed) {
        process.stderr.write('Cancelled\n');
        return;
      }
    }
    const api = new NominalAPI(config);
    const result = await api.integrationsDelete(workspaceId, id);
    formatOutput(config, result);
  },
};
