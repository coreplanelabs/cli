import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'type', 'version', 'active', 'createdBy', 'created'];

export const wikiListCommand: Command = {
  name: 'wiki list',
  description: 'List wikis',
  operationId: 'wikis.list',
  options: [
    { flag: '--type <t>', description: 'cloud_account | repository', type: 'string' },
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: ['nominal wiki list --type repository'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const type = getArgString(args, 'type');
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const api = new NominalAPI(config);
    const result = await api.wikisList(workspaceId, {
      perPage: limit,
      ...(type ? { type } : {}),
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
        headers: ['ID', 'Type', 'Version', 'Active', 'Created By', 'Created'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.type ?? ''),
          String(item.version ?? ''),
          String(item.active ?? ''),
          String(item.createdBy ?? ''),
          String(item.created ?? ''),
        ],
      }
    );
  },
};
