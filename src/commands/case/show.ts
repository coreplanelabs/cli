import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const caseShowCommand: Command = {
  name: 'case show',
  description: 'Show a case with markdown and synthesis',
  operationId: 'cases.get',
  positional: [{ name: 'case-id', description: 'The case ID (e.g. case_xxx...)' }],
  examples: ['nominal case show case_d18564pxsvozx979j3532mii2kk7pmw6'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const caseId = requirePositional(args, 0, 'case-id');
    const api = new NominalAPI(config);
    const result = await api.casesGet(workspaceId, caseId);
    formatOutput(config, result);
  },
};
