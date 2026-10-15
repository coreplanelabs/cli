import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const memoryShowCommand: Command = {
  name: 'memory show',
  description: 'Show a file from the workspace memory repository',
  operationId: 'memories.file',
  positional: [{ name: 'path', description: 'File path in the memory repository (from `memory list`)' }],
  examples: ['polylane memory show services/payments.md'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const path = requirePositional(args, 0, 'path').replace(/^\/+/, '');
    const api = new PolylaneAPI(config);
    formatOutput(config, await api.memoriesFile(workspaceId, { path }));
  },
};
