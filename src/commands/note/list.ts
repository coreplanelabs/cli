import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'date', 'threadCount', 'updated'];

export const noteListCommand: Command = {
  name: 'note list',
  description: 'List daily notes',
  operationId: 'notes.list',
  options: [
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: ['polylane note list', 'polylane note list --limit 7'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const api = new PolylaneAPI(config);
    const result = await api.notesList(workspaceId, { perPage: limit });

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
        headers: ['ID', 'Date', 'Threads', 'Updated'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.date ?? ''),
          String(item.threadCount ?? ''),
          String(item.updated ?? ''),
        ],
      }
    );
  },
};
