import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

const FIELDS = ['id', 'severity', 'status', 'title', 'resourceKind', 'resourceId', 'detectedAt', 'investigationThreadId'];
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
type Severity = (typeof VALID_SEVERITIES)[number];
const VALID_STATUSES = ['new', 'triaging', 'confirmed', 'dismissed', 'failed', 'skipped'] as const;
type Status = (typeof VALID_STATUSES)[number];

export const issueListCommand: Command = {
  name: 'issue list',
  description: 'List issues (detected anomalies and received alerts)',
  operationId: 'issues.list',
  options: [
    { flag: '--severity <s>', description: 'critical | high | medium | low | info', type: 'string' },
    { flag: '--status <s>', description: VALID_STATUSES.join(' | '), type: 'string' },
    { flag: '--active', description: 'Only currently active (unresolved) issues', type: 'boolean' },
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
    'polylane issue list',
    'polylane issue list --active --severity critical',
    'polylane issue list --status confirmed',
    'polylane issue list --provider aws --account 123456789012',
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
    const statusRaw = getArgString(args, 'status');
    if (statusRaw && !VALID_STATUSES.includes(statusRaw as Status)) {
      throw new CLIError(
        `Invalid --status: ${statusRaw}`,
        ExitCode.USAGE,
        `Must be one of: ${VALID_STATUSES.join(', ')}`
      );
    }

    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const api = new PolylaneAPI(config);
    const result = await api.issuesList(workspaceId, {
      limit,
      ...(severityRaw ? { severity: severityRaw as Severity } : {}),
      ...(statusRaw ? { status: statusRaw as Status } : {}),
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
        headers: ['ID', 'Severity', 'Status', 'Title', 'Kind', 'Resource', 'Detected', 'Investigation'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.severity ?? ''),
          String(item.status ?? ''),
          truncate(String(item.title ?? ''), 50),
          String(item.resourceKind ?? ''),
          truncate(String(item.resourceId ?? ''), 40),
          String(item.detectedAt ?? ''),
          String(item.investigationThreadId ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
