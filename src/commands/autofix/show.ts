import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const autofixShowCommand: Command = {
  name: 'autofix show',
  description: 'Show an autofix with its status, PR, and metadata',
  operationId: 'autofixes.get',
  positional: [{ name: 'autofix-id', description: 'The autofix ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'autofix-id');
    const api = new PolylaneAPI(config);
    const result = await api.autofixesGet(workspaceId, id);
    formatOutput(config, result);
  },
};
