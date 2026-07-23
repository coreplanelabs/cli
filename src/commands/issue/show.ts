import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const issueShowCommand: Command = {
  name: 'issue show',
  description: 'Show an issue with reasoning, metrics, and logs',
  operationId: 'issues.get',
  positional: [{ name: 'issue-id', description: 'The issue ID' }],
  examples: ['polylane issue show iss_xxx'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'issue-id');
    const api = new PolylaneAPI(config);
    const result = await api.issuesGet(workspaceId, id);
    formatOutput(config, result);
  },
};
