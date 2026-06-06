import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, requirePositional, getArgString, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'type', 'title', 'status', 'currentVersion', 'updated'];

export const artifactListCommand: Command = {
  name: 'artifact list',
  description: 'List artifacts produced in a thread (PRs, diagrams, dashboards, …)',
  operationId: 'artifacts.list',
  positional: [{ name: 'thread-id', description: 'Thread ID (thrd_…)' }],
  options: [
    { flag: '--type <t>', description: 'Filter by artifact type (e.g. github.pull_request, diagram)', type: 'string' },
    { flag: '--status <s>', description: 'Filter by status (draft | final)', type: 'string' },
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: [
    'polylane artifact list thrd_xxx',
    'polylane artifact list thrd_xxx --type github.pull_request',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const threadId = requirePositional(args, 0, 'thread-id');
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;
    const type = getArgString(args, 'type');
    const status = getArgString(args, 'status');

    const api = new PolylaneAPI(config);
    const result = await api.artifactsList(workspaceId, threadId, {
      perPage: limit,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    });

    if (full) {
      formatList(config, result as { items: Array<Record<string, unknown>>; count: number });
      return;
    }

    formatList(
      config,
      {
        items: projectItems(result.items as unknown as Array<Record<string, unknown>>, FIELDS),
        count: result.count,
      },
      {
        headers: ['ID', 'Type', 'Title', 'Status', 'Version', 'Updated'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.type ?? ''),
          truncate(String(item.title ?? ''), 50),
          String(item.status ?? ''),
          String(item.currentVersion ?? ''),
          String(item.updated ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
