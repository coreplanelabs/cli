import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'slug', 'description', 'disabled', 'created'];

export const datasetListCommand: Command = {
  name: 'dataset list',
  description: 'List datasets',
  operationId: 'datasets.list',
  options: [
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const api = new PolylaneAPI(config);
    const result = await api.datasetsList(workspaceId, { perPage: limit });

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
        headers: ['ID', 'Slug', 'Description', 'Disabled', 'Created'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.slug ?? ''),
          truncate(String(item.description ?? ''), 50),
          item.disabled ? 'yes' : 'no',
          String(item.created ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
