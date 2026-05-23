import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const noteSaveCommand: Command = {
  name: 'note save',
  description: 'Replace a daily note for a given date',
  operationId: 'notes.put',
  positional: [
    { name: 'note-id', description: 'The daily note ID' },
    { name: 'content', description: 'Markdown content', variadic: true },
  ],
  options: [
    { flag: '--date <yyyy-mm-dd>', description: 'Update the note date as well', type: 'string' },
  ],
  examples: [
    'nominal note save note_xxx "Deployed v0.2 to prod"',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'note-id');
    const contentParts = getAllPositional(args).slice(1);
    if (contentParts.length === 0) {
      throw new CLIError(
        'Missing <content>',
        ExitCode.USAGE,
        'nominal note save <note-id> "<markdown>"'
      );
    }
    const content = contentParts.join(' ');
    const date = getArgString(args, 'date');

    const api = new NominalAPI(config);
    const result = await api.notesPut(workspaceId, id, {
      content,
      ...(date ? { date } : {}),
    });
    formatOutput(config, result);
  },
};
