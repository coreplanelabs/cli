import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace } from '../helpers';

export const noteGlobalShowCommand: Command = {
  name: 'note global show',
  description: 'Show the workspace global note',
  operationId: 'notes.global.get',
  async execute(config: Config, _flags, _args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const api = new NominalAPI(config);
    const result = await api.notesGlobalGet(workspaceId);
    formatOutput(config, result);
  },
};
