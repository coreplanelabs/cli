import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const automationTriggerCommand: Command = {
  name: 'automation trigger',
  description: 'Manually trigger an automation to create an execution',
  operationId: 'automations.trigger',
  positional: [{ name: 'automation-id', description: 'The automation ID' }],
  examples: ['nominal automation trigger auto_xxx'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'automation-id');
    const api = new NominalAPI(config);
    const execution = await api.automationsTrigger({ workspaceId, id });
    formatOutput(config, execution);
  },
};
