import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const automationShowCommand: Command = {
  name: 'automation show',
  description: 'Show an automation with its full configuration',
  operationId: 'automations.get',
  positional: [{ name: 'automation-id', description: 'The automation ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'automation-id');
    const api = new NominalAPI(config);
    const result = await api.automationsGet(workspaceId, id);
    formatOutput(config, result);
  },
};
