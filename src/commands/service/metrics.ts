import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgString, parseDuration } from '../helpers';
import { resolveServiceId } from './id';

type NodeTypeArg = Parameters<NominalAPI['cloudInfraNodesMetricsSummary']>[0]['type'];

export const serviceMetricsCommand: Command = {
  name: 'service metrics',
  description: 'Fetch summary metrics for a service',
  operationId: 'cloud_infra.nodes.metrics.summary',
  positional: [{ name: 'service-id', description: 'Service identifier' }],
  options: [{ flag: '--since <dur>', description: 'Window (default 1h)', type: 'string' }],
  examples: ['nominal service metrics payments --since 24h'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const raw = requirePositional(args, 0, 'service-id');
    const service = await resolveServiceId(config, raw, workspaceId);

    const sinceStr = getArgString(args, 'since') ?? '1h';
    const sinceMs = parseDuration(sinceStr);
    const to = new Date().toISOString();
    const from = new Date(Date.now() - sinceMs).toISOString();

    const api = new NominalAPI(config);
    const metrics = await api.cloudInfraNodesMetricsSummary(
      {
        workspaceId,
        id: service.id,
        provider: service.provider,
        account: service.account,
        region: service.region,
        type: service.type as NodeTypeArg,
      },
      { from, to }
    );

    formatList(
      config,
      { items: metrics as Array<Record<string, unknown>>, count: metrics.length },
      {
        headers: ['Metric', 'Current', 'Previous', 'Unit', 'Direction'],
        rows: (item) => [
          String(item.label ?? ''),
          String(item.current ?? ''),
          String(item.previous ?? ''),
          String(item.unit ?? ''),
          String(item.direction ?? ''),
        ],
      }
    );
  },
};
