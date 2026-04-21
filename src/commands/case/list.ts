import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'title', 'severity', 'status', 'assignedTo', 'created'];

export const caseListCommand: Command = {
  name: 'case list',
  description: 'List cases',
  operationId: 'cases.list',
  options: [
    { flag: '--status <s>', description: 'Filter by status (new,investigating,identified,resolved,...)', type: 'string' },
    { flag: '--severity <s>', description: 'Filter by severity (critical,high,medium,low,info)', type: 'string' },
    { flag: '--limit <n>', description: 'Max items to return (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects (not projected)', type: 'boolean' },
  ],
  examples: [
    'nominal case list',
    'nominal case list --severity critical',
    'nominal case list --status investigating --limit 5',
  ],
  async execute(config: Config, flags: GlobalFlags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const api = new NominalAPI(config);

    const status = getArgString(args, 'status');
    const severity = getArgString(args, 'severity');
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const result = await api.casesList(workspaceId, {
      perPage: limit,
      page: 1,
      order: flags.order,
      status: status ? parseCsv(status) : undefined,
      severity: severity ? parseCsv(severity) : undefined,
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
        headers: ['ID', 'Title', 'Severity', 'Status', 'Assigned', 'Created'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.title ?? ''),
          String(item.severity ?? ''),
          String(item.status ?? ''),
          String(item.assignedTo ?? ''),
          String(item.created ?? ''),
        ],
      }
    );
  },
};

function parseCsv(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}
