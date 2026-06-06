import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

const FIELDS = ['id', 'name', 'type', 'created'];
const VALID_TYPES = ['chat', 'investigation', 'automation', 'autofix', 'incident'] as const;
type ThreadType = (typeof VALID_TYPES)[number];

export const threadListCommand: Command = {
  name: 'thread list',
  description: 'List conversation threads',
  operationId: 'threads.list',
  options: [
    { flag: '--type <t>', description: 'Filter by thread type (chat | investigation | automation | autofix | incident; comma-separated)', type: 'string' },
    { flag: '--labels <a,b,c>', description: 'Filter by labels (comma-separated)', type: 'string' },
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: [
    'polylane thread list',
    'polylane thread list --type incident',
    'polylane thread list --type chat,investigation --limit 50',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const typeRaw = getArgString(args, 'type');
    const types = typeRaw ? typeRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    if (types) {
      for (const t of types) {
        if (!VALID_TYPES.includes(t as ThreadType)) {
          throw new CLIError(
            `Invalid --type: ${t}`,
            ExitCode.USAGE,
            `Must be one of: ${VALID_TYPES.join(', ')}`
          );
        }
      }
    }

    const labels = getArgString(args, 'labels');

    const api = new PolylaneAPI(config);
    const result = await api.threadsList(workspaceId, {
      perPage: limit,
      ...(types && types.length > 0 ? { type: types.length === 1 ? types[0]! : types } : {}),
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
        headers: ['ID', 'Name', 'Type', 'Created'],
        rows: (item) => [
          String(item.id ?? ''),
          truncate(String(item.name ?? ''), 50),
          String(item.type ?? ''),
          String(item.created ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
