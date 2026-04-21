import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const caseInvestigateCommand: Command = {
  name: 'case investigate',
  description: 'Start an investigation for a case',
  operationId: 'cases.investigate',
  positional: [
    { name: 'case-id', description: 'The case ID' },
    { name: 'prompt', description: 'What to investigate', variadic: true },
  ],
  examples: [
    'nominal case investigate case_xxx "why did auth service latency spike around 10:30Z?"',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const caseId = requirePositional(args, 0, 'case-id');
    const promptParts = getAllPositional(args).slice(1);
    if (promptParts.length === 0) {
      throw new CLIError(
        'Missing <prompt>',
        ExitCode.USAGE,
        'nominal case investigate <case-id> "<what to investigate>"'
      );
    }
    const prompt = promptParts.join(' ');
    if (prompt.length < 10) {
      throw new CLIError('Prompt must be at least 10 characters', ExitCode.USAGE);
    }

    const api = new NominalAPI(config);
    const result = await api.casesInvestigate({ workspaceId, caseId, prompt });

    if (config.output === 'json') {
      formatOutput(config, result);
      return;
    }

    process.stdout.write(
      `Started investigation thread ${result.threadId} (hypothesis ${result.hypothesisId})\n`
    );
  },
};
