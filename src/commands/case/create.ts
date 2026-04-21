import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, getArgString, getArgNumber, parseJsonArg } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
const VALID_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const caseCreateCommand: Command = {
  name: 'case create',
  description: 'Create a new case',
  operationId: 'cases.post',
  options: [
    { flag: '--title <t>', description: 'Case title', type: 'string', required: true },
    { flag: '--severity <s>', description: 'critical|high|medium|low|info', type: 'string', required: true },
    { flag: '--markdown <m>', description: 'Detailed description in markdown', type: 'string', required: true },
    { flag: '--assigned-to <id>', description: 'User ID to assign the case to', type: 'string' },
    { flag: '--labels <a,b,c>', description: 'Comma-separated labels', type: 'string' },
    { flag: '--affected-resources <json>', description: 'JSON array of affected resources', type: 'string' },
    { flag: '--timeframe-from <ts>', description: 'Start time (unix ms)', type: 'number' },
    { flag: '--timeframe-to <ts>', description: 'End time (unix ms)', type: 'number' },
  ],
  examples: [
    'nominal case create --title "High 5xx on auth service" --severity high --markdown "Rate spiked at 10:30Z..."',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);

    const title = getArgString(args, 'title');
    const severityRaw = getArgString(args, 'severity');
    const markdown = getArgString(args, 'markdown');

    if (!title) throw new CLIError('Missing --title', ExitCode.USAGE);
    if (!severityRaw) throw new CLIError('Missing --severity', ExitCode.USAGE);
    if (!markdown) throw new CLIError('Missing --markdown', ExitCode.USAGE);
    if (!VALID_SEVERITIES.includes(severityRaw as Severity)) {
      throw new CLIError(
        `Invalid --severity: ${severityRaw}`,
        ExitCode.USAGE,
        `Must be one of: ${VALID_SEVERITIES.join(', ')}`
      );
    }

    const assignedTo = getArgString(args, 'assignedTo') ?? null;
    const labelsRaw = getArgString(args, 'labels');
    const labels = labelsRaw ? labelsRaw.split(',').map((s) => s.trim()) : undefined;
    const affectedResourcesRaw = getArgString(args, 'affectedResources');
    const affectedResources = affectedResourcesRaw
      ? (parseJsonArg(affectedResourcesRaw, '--affected-resources') as unknown)
      : undefined;
    const from = getArgNumber(args, 'timeframeFrom');
    const to = getArgNumber(args, 'timeframeTo');
    const timeframe = from !== undefined && to !== undefined ? { from, to } : undefined;

    const api = new NominalAPI(config);
    const body = {
      workspaceId,
      title,
      severity: severityRaw as Severity,
      markdown,
      assignedTo,
      ...(labels ? { labels } : {}),
      ...(affectedResources ? { affectedResources: affectedResources as never } : {}),
      ...(timeframe ? { timeframe } : {}),
    };

    const result = await api.casesPost(body);
    formatOutput(config, result);
  },
};
