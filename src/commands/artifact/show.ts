import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const artifactShowCommand: Command = {
  name: 'artifact show',
  description: 'Show an artifact including its current-version content',
  operationId: 'artifacts.get',
  positional: [
    { name: 'thread-id', description: 'Thread ID (thrd_…)' },
    { name: 'artifact-id', description: 'Artifact ID' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const id = requirePositional(args, 1, 'artifact-id');
    const api = new PolylaneAPI(config);
    const result = await api.artifactsGet(workspaceId, threadId, id);
    formatOutput(config, result);
  },
};
