import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { getArgBoolean } from '../helpers';

const FIELDS = ['id', 'name', 'slug', 'ownerId'];

export const workspaceListCommand: Command = {
  name: 'workspace list',
  description: 'List workspaces the current user belongs to',
  operationId: 'workspaces.list',
  options: [{ flag: '--full', description: 'Return full objects', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const api = new NominalAPI(config);
    const result = await api.workspacesList({ perPage: 100 });
    const full = getArgBoolean(args, 'full') === true;

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
        headers: ['ID', 'Name', 'Slug', 'Owner'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.name ?? ''),
          String(item.slug ?? ''),
          String(item.ownerId ?? ''),
        ],
      }
    );
  },
};
