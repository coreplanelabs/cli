import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, requirePositional, getArgNumber, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'status', 'threadId', 'caseId', 'durationMs', 'triggeredAt'];

export const automationExecutionsCommand: Command = {
  name: 'automation executions',
  description: 'List executions for an automation',
  operationId: 'automations.executions.list',
  positional: [{ name: 'automation-id', description: 'The automation ID' }],
  options: [
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const automationId = requirePositional(args, 0, 'automation-id');
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const api = new NominalAPI(config);
    const result = await api.automationsExecutionsList(workspaceId, automationId, { perPage: limit });

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
        headers: ['ID', 'Status', 'Thread', 'Case', 'Duration (ms)', 'Triggered'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.status ?? ''),
          String(item.threadId ?? ''),
          String(item.caseId ?? ''),
          item.durationMs === null || item.durationMs === undefined ? '' : String(item.durationMs),
          String(item.triggeredAt ?? ''),
        ],
      }
    );
  },
};
