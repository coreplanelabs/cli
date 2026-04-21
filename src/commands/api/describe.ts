import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { OPERATIONS, type OperationMeta } from '../../generated/commands';
import { formatOutput } from '../../output/formatter';
import { requirePositional } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const apiDescribeCommand: Command = {
  name: 'api describe',
  description: 'Show details of an API operation',
  positional: [{ name: 'operation-id', description: 'The operationId (e.g. workspaces.list)' }],
  examples: ['nominal api describe workspaces.list'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const opId = requirePositional(args, 0, 'operation-id');
    const ops: OperationMeta[] = Object.values(OPERATIONS);
    const op = ops.find((o) => o.operationId === opId);
    if (!op) {
      throw new CLIError(
        `Unknown operation: ${opId}`,
        ExitCode.USAGE,
        'Use `nominal api list` to find the right operationId'
      );
    }
    formatOutput(config, op as unknown as Record<string, unknown>);
  },
};
