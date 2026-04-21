import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'slug', 'name', 'source', 'visibility', 'created', '_html_url'];

export const skillListCommand: Command = {
  name: 'skill list',
  description: 'List skills in the workspace',
  operationId: 'skills.list',
  options: [
    { flag: '--source <s>', description: 'Filter by source: template | manual | generated', type: 'string' },
    { flag: '--labels <a,b,c>', description: 'Comma-separated labels', type: 'string' },
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const sourceRaw = getArgString(args, 'source');
    const source =
      sourceRaw === 'template' || sourceRaw === 'manual' || sourceRaw === 'generated'
        ? sourceRaw
        : undefined;
    const labels = getArgString(args, 'labels');
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const api = new NominalAPI(config);
    const result = await api.skillsList(workspaceId, {
      perPage: limit,
      ...(source ? { source } : {}),
      ...(labels ? { labels } : {}),
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
        headers: ['ID', 'Slug', 'Name', 'Source', 'Visibility', 'Created', 'Console'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.slug ?? ''),
          truncate(String(item.name ?? ''), 40),
          String(item.source ?? ''),
          String(item.visibility ?? ''),
          String(item.created ?? ''),
          String(item._html_url ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
