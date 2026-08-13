import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { requireWorkspace, getArgBoolean } from '../helpers';
import { promptConfirm } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';

export const noteGlobalClearCommand: Command = {
  name: 'note global clear',
  description: 'Delete the workspace global note',
  operationId: 'notes.global.del',
  options: [{ flag: '--yes', description: 'Skip confirmation', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);

    if (getArgBoolean(args, 'yes') !== true && isInteractive(config.nonInteractive)) {
      const ok = await promptConfirm(
        { nonInteractive: config.nonInteractive },
        `Clear the workspace global note?`,
        false
      );
      if (!ok) {
        process.stderr.write('Cancelled. Nothing changed.\n');
        return;
      }
    }

    const api = new PolylaneAPI(config);
    await api.notesGlobalDel(workspaceId);
    process.stdout.write(`Cleared global note\n`);
  },
};
