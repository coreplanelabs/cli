import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { getArgBoolean } from '../helpers';

const FIELDS = ['slug', 'name', 'description'];

export const skillCatalogCommand: Command = {
  name: 'skill catalog',
  description: 'List public skill templates',
  operationId: 'skills.catalog',
  options: [{ flag: '--full', description: 'Return full objects', type: 'boolean' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const full = getArgBoolean(args, 'full') === true;
    const api = new NominalAPI(config);
    const result = await api.skillsCatalog();

    if (full) {
      formatList(config, {
        items: result.items as unknown as Array<Record<string, unknown>>,
        count: result.items.length,
      });
      return;
    }

    const projected = projectItems(result.items as unknown as Array<Record<string, unknown>>, FIELDS);
    formatList(
      config,
      { items: projected, count: projected.length },
      {
        headers: ['Slug', 'Name', 'Description'],
        rows: (item) => [
          String(item.slug ?? ''),
          String(item.name ?? ''),
          truncate(String(item.description ?? ''), 60),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
