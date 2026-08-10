import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const datasetShowCommand: Command = {
  name: 'dataset show',
  description: 'Show a dataset with its full configuration',
  operationId: 'datasets.get',
  positional: [{ name: 'dataset-id', description: 'The dataset ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'dataset-id');
    const api = new PolylaneAPI(config);
    const result = await api.datasetsGet(workspaceId, id);
    formatOutput(config, result);
  },
};
