import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const anomalyShowCommand: Command = {
  name: 'anomaly show',
  description: 'Show an anomaly with reasoning, metrics, and logs',
  operationId: 'anomalies.get',
  positional: [{ name: 'anomaly-id', description: 'The anomaly ID' }],
  examples: ['polylane anomaly show anom_xxx'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'anomaly-id');
    const api = new PolylaneAPI(config);
    const result = await api.anomaliesGet({ workspaceId, id });
    formatOutput(config, result);
  },
};
