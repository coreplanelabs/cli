import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgString } from '../helpers';

export const datasetCreateCommand: Command = {
  name: 'dataset create',
  description: 'Create a dataset',
  operationId: 'datasets.post',
  positional: [{ name: 'slug', description: 'Name of the dataset' }],
  options: [
    { flag: '--description <text>', description: 'Description of the dataset', type: 'string' },
  ],
  examples: ['polylane dataset create production-traces --description "Traces from prod"'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const slug = requirePositional(args, 0, 'slug');
    const description = getArgString(args, 'description');

    const api = new PolylaneAPI(config);
    const result = await api.datasetsPost({
      workspaceId,
      slug,
      ...(description ? { description } : {}),
    });
    formatOutput(config, result);
  },
};
