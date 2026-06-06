import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

const FIELDS = ['id', 'severity', 'title', 'resourceKind', 'resourceId', 'detectedAt', 'incidentThreadId'];
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
type Severity = (typeof VALID_SEVERITIES)[number];

export const anomalyListCommand: Command = {
  name: 'anomaly list',
  description: 'List anomalies (system-detected issues)',
  operationId: 'anomalies.list',
  options: [
    { flag: '--severity <s>', description: 'critical | high | medium | low | info', type: 'string' },
    { flag: '--active', description: 'Only currently active (unresolved) anomalies', type: 'boolean' },
    { flag: '--since <ms>', description: 'Detected at or after (unix ms)', type: 'number' },
    { flag: '--until <ms>', description: 'Detected at or before (unix ms)', type: 'number' },
    { flag: '--provider <p>', description: 'Cloud provider (aws, gcp, …)', type: 'string' },
    { flag: '--account <a>', description: 'Cloud account identifier', type: 'string' },
    { flag: '--region <r>', description: 'Cloud region', type: 'string' },
    { flag: '--node-type <t>', description: 'Node type (e.g. lambda.function)', type: 'string' },
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: [
    'polylane anomaly list',
    'polylane anomaly list --active --severity critical',
    'polylane anomaly list --provider aws --account 123456789012',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const severityRaw = getArgString(args, 'severity');
    if (severityRaw && !VALID_SEVERITIES.includes(severityRaw as Severity)) {
      throw new CLIError(
        `Invalid --severity: ${severityRaw}`,
        ExitCode.USAGE,
        `Must be one of: ${VALID_SEVERITIES.join(', ')}`
      );
    }

    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const api = new PolylaneAPI(config);
    const result = await api.anomaliesList({
      kind: 'workspace',
      workspaceId,
      limit,
      ...(severityRaw ? { severity: severityRaw as Severity } : {}),
      ...(getArgBoolean(args, 'active') === true ? { active: true } : {}),
      ...(getArgNumber(args, 'since') !== undefined ? { since: getArgNumber(args, 'since') } : {}),
      ...(getArgNumber(args, 'until') !== undefined ? { until: getArgNumber(args, 'until') } : {}),
      ...(getArgString(args, 'provider') ? { provider: getArgString(args, 'provider') } : {}),
      ...(getArgString(args, 'account') ? { account: getArgString(args, 'account') } : {}),
      ...(getArgString(args, 'region') ? { region: getArgString(args, 'region') } : {}),
      ...(getArgString(args, 'nodeType') ? { nodeType: getArgString(args, 'nodeType') } : {}),
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
        headers: ['ID', 'Severity', 'Title', 'Kind', 'Resource', 'Detected', 'Incident'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.severity ?? ''),
          truncate(String(item.title ?? ''), 50),
          String(item.resourceKind ?? ''),
          truncate(String(item.resourceId ?? ''), 40),
          String(item.detectedAt ?? ''),
          String(item.incidentThreadId ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
