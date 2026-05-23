import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const incidentMilestoneCommand: Command = {
  name: 'incident milestone',
  description: 'Append a milestone event to an incident timeline',
  operationId: 'incidents.timeline.create',
  positional: [
    { name: 'thread-id', description: 'Incident thread ID (thrd_…)' },
    { name: 'title', description: 'Short milestone title (e.g. "Mitigated")', variadic: true },
  ],
  options: [
    { flag: '--body <b>', description: 'Optional markdown body', type: 'string' },
  ],
  examples: [
    'nominal incident milestone thrd_xxx "Mitigated"',
    'nominal incident milestone thrd_xxx "Resolved" --body "Root cause fixed in PR #123"',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const titleParts = getAllPositional(args).slice(1);
    if (titleParts.length === 0) {
      throw new CLIError(
        'Missing <title>',
        ExitCode.USAGE,
        'nominal incident milestone <thread-id> "<title>"'
      );
    }
    const title = titleParts.join(' ');
    const body = getArgString(args, 'body');

    const api = new NominalAPI(config);
    const result = await api.incidentsTimelineCreate({
      workspaceId,
      incidentThreadId: threadId,
      type: 'milestone',
      title,
      ...(body ? { body } : {}),
    });
    formatOutput(config, result);
  },
};
