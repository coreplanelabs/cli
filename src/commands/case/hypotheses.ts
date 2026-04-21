import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, requirePositional, getArgBoolean } from '../helpers';

const FIELDS = ['id', 'name', 'investigationVerdict', 'investigationConfidence', 'investigationStatus'];

export const caseHypothesesCommand: Command = {
  name: 'case hypotheses',
  description: 'List hypotheses for a case with their verdicts',
  operationId: 'cases.hypotheses.list',
  positional: [{ name: 'case-id', description: 'The case ID' }],
  options: [{ flag: '--full', description: 'Return full objects', type: 'boolean' }],
  examples: ['nominal case hypotheses case_xxx'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const caseId = requirePositional(args, 0, 'case-id');
    const api = new NominalAPI(config);

    const result = await api.casesHypothesesList(workspaceId, caseId);
    const full = getArgBoolean(args, 'full') === true;

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
        headers: ['ID', 'Name', 'Verdict', 'Confidence', 'Status'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.name ?? ''),
          String(item.investigationVerdict ?? ''),
          String(item.investigationConfidence ?? ''),
          String(item.investigationStatus ?? ''),
        ],
      }
    );
  },
};
