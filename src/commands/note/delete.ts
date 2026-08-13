import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { requireWorkspace, requirePositional, getArgBoolean } from '../helpers';
import { promptConfirm } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';

export const noteDeleteCommand: Command = {
  name: 'note delete',
  description: 'Delete a daily note',
  operationId: 'notes.del',
  positional: [{ name: 'note-id', description: 'The daily note ID' }],
  options: [{ flag: '--yes', description: 'Skip confirmation', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'note-id');

    if (getArgBoolean(args, 'yes') !== true && isInteractive(config.nonInteractive)) {
      const ok = await promptConfirm(
        { nonInteractive: config.nonInteractive },
        `Delete note ${id}?`,
        false
      );
      if (!ok) {
        process.stderr.write('Cancelled. Nothing changed.\n');
        return;
      }
    }

    const api = new PolylaneAPI(config);
    const result = await api.notesDel(workspaceId, id);
    process.stdout.write(`Deleted ${result.id}\n`);
  },
};
