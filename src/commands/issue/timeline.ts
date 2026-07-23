import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, requirePositional, getArgString, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'at', 'type', 'title', 'createdBy'];

export const issueTimelineCommand: Command = {
  name: 'issue timeline',
  description: 'Show the timeline of events for an issue',
  operationId: 'issues.timeline.list',
  positional: [{ name: 'issue-id', description: 'Issue ID (iss_…)' }],
  options: [
    { flag: '--types <a,b,c>', description: 'Filter by event types (comma-separated)', type: 'string' },
    { flag: '--from <ms>', description: 'Lower bound (unix ms)', type: 'number' },
    { flag: '--to <ms>', description: 'Upper bound (unix ms)', type: 'number' },
    { flag: '--limit <n>', description: 'Max items (default 100)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: [
    'polylane issue timeline iss_xxx',
    'polylane issue timeline iss_xxx --types note,milestone',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const issueId = requirePositional(args, 0, 'issue-id');
    const limit = getArgNumber(args, 'limit') ?? 100;
    const full = getArgBoolean(args, 'full') === true;
    const types = getArgString(args, 'types');
    const from = getArgNumber(args, 'from');
    const to = getArgNumber(args, 'to');

    const api = new PolylaneAPI(config);
    const result = await api.issuesTimelineList({
      workspaceId,
      issueId,
      perPage: limit,
      ...(types ? { types } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });

    if (full) {
      formatList(config, { items: result.items as unknown as Array<Record<string, unknown>>, count: result.total });
      return;
    }

    formatList(
      config,
      {
        items: projectItems(result.items as unknown as Array<Record<string, unknown>>, FIELDS),
        count: result.total,
      },
      {
        headers: ['ID', 'At', 'Type', 'Title', 'Author'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.at ?? ''),
          String(item.type ?? ''),
          truncate(String(item.title ?? ''), 60),
          String(item.createdBy ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
