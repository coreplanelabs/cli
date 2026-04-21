import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const automationExecutionCommand: Command = {
  name: 'automation execution',
  description: 'Show an automation execution (includes result)',
  operationId: 'automations.executions.get',
  positional: [
    { name: 'automation-id', description: 'The automation ID' },
    { name: 'execution-id', description: 'The execution ID' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const automationId = requirePositional(args, 0, 'automation-id');
    const executionId = requirePositional(args, 1, 'execution-id');
    const api = new NominalAPI(config);
    const result = await api.automationsExecutionsGet(workspaceId, automationId, executionId);
    formatOutput(config, result);
  },
};
