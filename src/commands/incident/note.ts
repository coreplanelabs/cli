import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const incidentNoteCommand: Command = {
  name: 'incident note',
  description: 'Append a note to an incident timeline',
  operationId: 'incidents.timeline.create',
  positional: [
    { name: 'thread-id', description: 'Incident thread ID (thrd_…)' },
    { name: 'body', description: 'Markdown body of the note', variadic: true },
  ],
  options: [
    { flag: '--title <t>', description: 'Optional short title', type: 'string' },
  ],
  examples: [
    'nominal incident note thrd_xxx "rolled back deploy abc123"',
    'nominal incident note thrd_xxx --title "Workaround" "increased lambda concurrency to 200"',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const bodyParts = getAllPositional(args).slice(1);
    if (bodyParts.length === 0) {
      throw new CLIError(
        'Missing <body>',
        ExitCode.USAGE,
        'nominal incident note <thread-id> "<markdown body>"'
      );
    }
    const body = bodyParts.join(' ');
    const title = getArgString(args, 'title');

    const api = new NominalAPI(config);
    const result = await api.incidentsTimelineCreate({
      workspaceId,
      incidentThreadId: threadId,
      type: 'note',
      body,
      ...(title ? { title } : {}),
    });
    formatOutput(config, result);
  },
};
