import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const memoryShowCommand: Command = {
  name: 'memory show',
  description: 'Show a memory with its markdown body',
  operationId: 'memories.get',
  positional: [{ name: 'memory-id', description: 'The memory ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'memory-id');
    const api = new NominalAPI(config);
    const result = await api.memoriesGet(workspaceId, id);
    formatOutput(config, result);
  },
};
