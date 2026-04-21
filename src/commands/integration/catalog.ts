import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { getArgBoolean, getArgString } from '../helpers';

const FIELDS = ['type', 'category', 'subcategory', 'name', 'comingSoon', '_html_url'];

export const integrationCatalogCommand: Command = {
  name: 'integration catalog',
  description: 'Browse available integrations and cloud providers',
  operationId: 'integrations.public_catalog',
  options: [
    { flag: '--category <cat>', description: 'Filter by category: tool | cloud', type: 'string' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const category = getArgString(args, 'category');
    const full = getArgBoolean(args, 'full') === true;
    const api = new NominalAPI(config);
    const result = await api.integrationsPublicCatalog();
    const items = category ? result.items.filter((i) => i.category === category) : result.items;

    if (full) {
      formatList(
        config,
        { items: items as unknown as Array<Record<string, unknown>>, count: items.length }
      );
      return;
    }

    const projected = projectItems(items as unknown as Array<Record<string, unknown>>, FIELDS);
    formatList(
      config,
      { items: projected, count: projected.length },
      {
        headers: ['Type', 'Category', 'Subcategory', 'Name', 'Coming Soon', 'Console'],
        rows: (item) => [
          String(item.type ?? ''),
          String(item.category ?? ''),
          String(item.subcategory ?? ''),
          String(item.name ?? ''),
          item.comingSoon ? 'yes' : '',
          String(item._html_url ?? ''),
        ],
      }
    );
  },
};
