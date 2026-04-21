import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'name', 'owner', 'provider', 'status', 'description'];

export const repoListCommand: Command = {
  name: 'repo list',
  description: 'List repositories',
  operationId: 'repositories.list',
  options: [
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: ['nominal repo list'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const api = new NominalAPI(config);
    const result = await api.repositoriesList(workspaceId, { perPage: limit });

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
        headers: ['ID', 'Name', 'Owner', 'Provider', 'Status', 'Description'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.name ?? ''),
          String(item.owner ?? ''),
          String(item.provider ?? ''),
          String(item.status ?? ''),
          truncate(String(item.description ?? ''), 60),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
