import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const caseHypothesisCommand: Command = {
  name: 'case hypothesis',
  description: 'Show a hypothesis with its verdict summary',
  operationId: 'cases.hypotheses.get',
  positional: [
    { name: 'case-id', description: 'The case ID' },
    { name: 'hypothesis-id', description: 'The hypothesis ID' },
  ],
  examples: ['nominal case hypothesis case_xxx hyp_yyy'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const caseId = requirePositional(args, 0, 'case-id');
    const hypothesisId = requirePositional(args, 1, 'hypothesis-id');
    const api = new NominalAPI(config);
    const result = await api.casesHypothesesGet(workspaceId, caseId, hypothesisId);
    formatOutput(config, result);
  },
};
