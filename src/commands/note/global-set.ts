import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional } from '../helpers';

export const noteGlobalSetCommand: Command = {
  name: 'note global set',
  description: 'Replace the workspace global note',
  operationId: 'notes.global.put',
  positional: [{ name: 'content', description: 'Markdown content', variadic: true }],
  examples: ['nominal note global set "Production runbook: …"'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'content');
    const content = getAllPositional(args).join(' ');
    const api = new NominalAPI(config);
    const result = await api.notesGlobalPut(workspaceId, { content });
    formatOutput(config, result);
  },
};
