import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const issueNoteCommand: Command = {
  name: 'issue note',
  description: 'Append a note to an issue timeline',
  operationId: 'issues.timeline.create',
  positional: [
    { name: 'issue-id', description: 'Issue ID (iss_…)' },
    { name: 'body', description: 'Markdown body of the note', variadic: true },
  ],
  options: [
    { flag: '--title <t>', description: 'Optional short title', type: 'string' },
  ],
  examples: [
    'polylane issue note iss_xxx "rolled back deploy abc123"',
    'polylane issue note iss_xxx --title "Workaround" "increased lambda concurrency to 200"',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const issueId = requirePositional(args, 0, 'issue-id');
    const bodyParts = getAllPositional(args).slice(1);
    if (bodyParts.length === 0) {
      throw new CLIError(
        'Missing <body>',
        ExitCode.USAGE,
        'polylane issue note <issue-id> "<markdown body>"'
      );
    }
    const body = bodyParts.join(' ');
    const title = getArgString(args, 'title');

    const api = new PolylaneAPI(config);
    const result = await api.issuesTimelineCreate({
      workspaceId,
      issueId,
      type: 'note',
      body,
      ...(title ? { title } : {}),
    });
    formatOutput(config, result);
  },
};
