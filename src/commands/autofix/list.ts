import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'status', 'origin', 'repo', 'branch', 'submittedPrNumber', 'created'];

export const autofixListCommand: Command = {
  name: 'autofix list',
  description: 'List autofixes (automated code fixes)',
  operationId: 'autofixes.list',
  options: [
    { flag: '--status <s>', description: 'Filter by status (started, branch_pushed, pr_opened, merged, failed, no_fix_needed)', type: 'string' },
    { flag: '--origin <o>', description: 'Filter by origin (automation, chat, incident)', type: 'string' },
    { flag: '--repo <r>', description: 'Filter by repo name', type: 'string' },
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: [
    'polylane autofix list',
    'polylane autofix list --status pr_opened',
    'polylane autofix list --origin incident --repo my-service',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;
    const status = getArgString(args, 'status');
    const origin = getArgString(args, 'origin');
    const repo = getArgString(args, 'repo');

    const api = new PolylaneAPI(config);
    const result = await api.autofixesList(workspaceId, {
      perPage: limit,
      ...(status ? { status } : {}),
      ...(origin ? { origin } : {}),
      ...(repo ? { repo } : {}),
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
        headers: ['ID', 'Status', 'Origin', 'Repo', 'Branch', 'PR', 'Created'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.status ?? ''),
          String(item.origin ?? ''),
          String(item.repo ?? ''),
          truncate(String(item.branch ?? ''), 30),
          String(item.submittedPrNumber ?? ''),
          String(item.created ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
