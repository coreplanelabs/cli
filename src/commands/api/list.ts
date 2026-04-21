import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { OPERATIONS, type OperationMeta } from '../../generated/commands';
import { formatList } from '../../output/formatter';
import { getArgString } from '../helpers';

export const apiListCommand: Command = {
  name: 'api list',
  description: 'List available API operations',
  options: [
    { flag: '--tag <t>', description: 'Filter by tag', type: 'string' },
    { flag: '--query <q>', description: 'Filter by substring match in path or summary', type: 'string' },
  ],
  examples: ['nominal api list --tag Cases', 'nominal api list --query workspace'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const tag = getArgString(args, 'tag')?.toLowerCase();
    const query = getArgString(args, 'query')?.toLowerCase();

    const ops: OperationMeta[] = Object.values(OPERATIONS);
    const filtered = ops.filter((op) => {
      if (tag && op.tag.toLowerCase() !== tag) return false;
      if (query) {
        const hay = (op.path + ' ' + op.summary + ' ' + op.operationId).toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const items = filtered.map((op) => ({
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      tag: op.tag,
      summary: op.summary,
    }));

    formatList(
      config,
      { items, count: items.length },
      {
        headers: ['Operation', 'Method', 'Path', 'Tag', 'Summary'],
        rows: (item) => [
          String(item.operationId ?? ''),
          String(item.method ?? ''),
          String(item.path ?? ''),
          String(item.tag ?? ''),
          truncate(String(item.summary ?? ''), 50),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
