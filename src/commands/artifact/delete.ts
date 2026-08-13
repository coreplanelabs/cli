import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { requireWorkspace, requirePositional, getArgBoolean } from '../helpers';
import { promptConfirm } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';

export const artifactDeleteCommand: Command = {
  name: 'artifact delete',
  description: 'Delete an artifact',
  operationId: 'artifacts.delete',
  positional: [
    { name: 'thread-id', description: 'Thread ID (thrd_…)' },
    { name: 'artifact-id', description: 'Artifact ID' },
  ],
  options: [{ flag: '--yes', description: 'Skip confirmation', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const id = requirePositional(args, 1, 'artifact-id');

    if (getArgBoolean(args, 'yes') !== true && isInteractive(config.nonInteractive)) {
      const ok = await promptConfirm(
        { nonInteractive: config.nonInteractive },
        `Delete artifact ${id}?`,
        false
      );
      if (!ok) {
        process.stderr.write('Cancelled. Nothing changed.\n');
        return;
      }
    }

    const api = new PolylaneAPI(config);
    const result = await api.artifactsDelete(workspaceId, threadId, id);
    process.stdout.write(`Deleted ${result.id}\n`);
  },
};
