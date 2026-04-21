import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { getArgBoolean } from '../helpers';

const FIELDS = ['slug', 'name', 'category', 'triggerType', 'description', '_html_url'];

export const automationCatalogCommand: Command = {
  name: 'automation catalog',
  description: 'List public automation templates',
  operationId: 'automations.public_catalog',
  options: [
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const full = getArgBoolean(args, 'full') === true;
    const api = new NominalAPI(config);
    const result = await api.automationsPublicCatalog();

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
        headers: ['Slug', 'Name', 'Category', 'Trigger', 'Description', 'Console'],
        rows: (item) => [
          String(item.slug ?? ''),
          String(item.name ?? ''),
          String(item.category ?? ''),
          String(item.triggerType ?? ''),
          truncate(String(item.description ?? ''), 60),
          String(item._html_url ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
