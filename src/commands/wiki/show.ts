import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const wikiShowCommand: Command = {
  name: 'wiki show',
  description: 'Show a wiki',
  operationId: 'wikis.get',
  positional: [{ name: 'wiki-id', description: 'The wiki ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const wikiId = requirePositional(args, 0, 'wiki-id');
    const api = new NominalAPI(config);
    const result = await api.wikisGet(workspaceId, wikiId);
    formatOutput(config, result);
  },
};
