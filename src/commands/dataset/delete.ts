import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { requireWorkspace, requirePositional, getArgBoolean } from '../helpers';
import { promptConfirm } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';

export const datasetDeleteCommand: Command = {
  name: 'dataset delete',
  description: 'Delete a dataset',
  operationId: 'datasets.del',
  positional: [{ name: 'dataset-id', description: 'The dataset ID' }],
  options: [{ flag: '--yes', description: 'Skip confirmation', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'dataset-id');

    if (getArgBoolean(args, 'yes') !== true && isInteractive(config.nonInteractive)) {
      const ok = await promptConfirm(
        { nonInteractive: config.nonInteractive },
        `Delete dataset ${id}?`,
        false
      );
      if (!ok) {
        process.stderr.write('Cancelled\n');
        return;
      }
    }

    const api = new PolylaneAPI(config);
    const result = await api.datasetsDel(workspaceId, id);
    process.stdout.write(`Deleted ${result.id}\n`);
  },
};
