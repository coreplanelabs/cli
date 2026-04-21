import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const skillShowCommand: Command = {
  name: 'skill show',
  description: 'Show a skill with its instructions and documents',
  operationId: 'skills.get',
  positional: [{ name: 'skill-id', description: 'The skill ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'skill-id');
    const api = new NominalAPI(config);
    const result = await api.skillsGet(workspaceId, id);
    formatOutput(config, result);
  },
};
