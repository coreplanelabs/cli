import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { requireWorkspace, requirePositional, getArgBoolean } from '../helpers';
import { promptConfirm } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';

export const memoryDeleteCommand: Command = {
  name: 'memory delete',
  description: 'Delete a memory',
  operationId: 'memories.del',
  positional: [{ name: 'memory-id', description: 'The memory ID' }],
  options: [{ flag: '--yes', description: 'Skip confirmation', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'memory-id');

    if (getArgBoolean(args, 'yes') !== true && isInteractive(config.nonInteractive)) {
      const ok = await promptConfirm(
        { nonInteractive: config.nonInteractive },
        `Delete memory ${id}?`,
        false
      );
      if (!ok) {
        process.stderr.write('Cancelled\n');
        return;
      }
    }

    const api = new NominalAPI(config);
    const result = await api.memoriesDel(workspaceId, id);
    process.stdout.write(`Deleted ${result.id}\n`);
  },
};
