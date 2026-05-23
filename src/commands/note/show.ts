import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const noteShowCommand: Command = {
  name: 'note show',
  description: 'Show a daily note',
  operationId: 'notes.get',
  positional: [{ name: 'note-id', description: 'The daily note ID' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'note-id');
    const api = new NominalAPI(config);
    const result = await api.notesGet(workspaceId, id);
    formatOutput(config, result);
  },
};
