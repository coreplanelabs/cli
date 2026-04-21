import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { getPositional } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const workspaceShowCommand: Command = {
  name: 'workspace show',
  description: 'Show a workspace (default: current)',
  operationId: 'workspaces.get',
  positional: [{ name: 'workspace-id', description: 'Workspace ID (default: current)', required: false }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const id = getPositional(args, 0) ?? config.workspaceId;
    if (!id) {
      throw new CLIError(
        'No workspace ID provided and none set in config',
        ExitCode.USAGE,
        'nominal workspace show <id>     or     nominal workspace use <id>'
      );
    }
    const api = new NominalAPI(config);
    const result = await api.workspacesGet(id);
    formatOutput(config, result);
  },
};
