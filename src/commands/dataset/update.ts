import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgString, getArgBoolean } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const datasetUpdateCommand: Command = {
  name: 'dataset update',
  description: 'Update a dataset (description, enable/disable)',
  operationId: 'datasets.patch',
  positional: [{ name: 'dataset-id', description: 'The dataset ID' }],
  options: [
    { flag: '--description <text>', description: 'New description', type: 'string' },
    { flag: '--enable', description: 'Enable ingestion for the dataset', type: 'boolean' },
    { flag: '--disable', description: 'Disable ingestion for the dataset', type: 'boolean' },
  ],
  examples: [
    'polylane dataset update ds_xxx --description "Traces from prod"',
    'polylane dataset update ds_xxx --disable',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'dataset-id');
    const description = getArgString(args, 'description');
    const enable = getArgBoolean(args, 'enable') === true;
    const disable = getArgBoolean(args, 'disable') === true;

    if (enable && disable) {
      throw new CLIError('--enable and --disable are mutually exclusive', ExitCode.USAGE);
    }
    if (!description && !enable && !disable) {
      throw new CLIError(
        'Nothing to update',
        ExitCode.USAGE,
        'Pass at least one of --description, --enable, --disable'
      );
    }

    const api = new PolylaneAPI(config);
    const result = await api.datasetsPatch(workspaceId, id, {
      ...(description ? { description } : {}),
      ...(enable ? { disabled: null } : {}),
      ...(disable ? { disabled: new Date().toISOString() } : {}),
    });
    formatOutput(config, result);
  },
};
