import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const issueMilestoneCommand: Command = {
  name: 'issue milestone',
  description: 'Append a milestone event to an issue timeline',
  operationId: 'issues.timeline.create',
  positional: [
    { name: 'issue-id', description: 'Issue ID (iss_…)' },
    { name: 'title', description: 'Short milestone title (e.g. "Mitigated")', variadic: true },
  ],
  options: [
    { flag: '--body <b>', description: 'Optional markdown body', type: 'string' },
  ],
  examples: [
    'polylane issue milestone iss_xxx "Mitigated"',
    'polylane issue milestone iss_xxx "Resolved" --body "Root cause fixed in PR #123"',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const issueId = requirePositional(args, 0, 'issue-id');
    const titleParts = getAllPositional(args).slice(1);
    if (titleParts.length === 0) {
      throw new CLIError(
        'Missing <title>',
        ExitCode.USAGE,
        'polylane issue milestone <issue-id> "<title>"'
      );
    }
    const title = titleParts.join(' ');
    const body = getArgString(args, 'body');

    const api = new PolylaneAPI(config);
    const result = await api.issuesTimelineCreate({
      workspaceId,
      issueId,
      type: 'milestone',
      title,
      ...(body ? { body } : {}),
    });
    formatOutput(config, result);
  },
};
