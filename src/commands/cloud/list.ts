import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'provider', 'account', 'region', 'alias', 'status', 'lastSync'];

export const cloudListCommand: Command = {
  name: 'cloud list',
  description: 'List connected cloud accounts in the current workspace',
  operationId: 'cloud_accounts.list',
  options: [
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;
    const api = new NominalAPI(config);
    const result = await api.cloudAccountsList(workspaceId, { perPage: limit });

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
        headers: ['ID', 'Provider', 'Account', 'Region', 'Alias', 'Status', 'Last Sync'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.provider ?? ''),
          String(item.account ?? ''),
          String(item.region ?? ''),
          String(item.alias ?? ''),
          String(item.status ?? ''),
          String(item.lastSync ?? ''),
        ],
      }
    );
  },
};
