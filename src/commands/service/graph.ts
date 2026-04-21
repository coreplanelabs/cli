import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgNumber, getArgString } from '../helpers';
import { resolveServiceId, type Provider } from './id';

type NodeTypeArg = Parameters<NominalAPI['cloudInfraNodesListNeighbours']>[0]['params']['type'];
type NeighborsFn = 'inbound' | 'outbound';
type Direction = NeighborsFn | 'both';

interface GraphRow extends Record<string, unknown> {
  direction: NeighborsFn;
  id: string;
  type: string;
}

export const serviceGraphCommand: Command = {
  name: 'service graph',
  description: 'Show services connected to a given service',
  operationId: 'cloud_infra.nodes.neighbours',
  positional: [{ name: 'service-id', description: 'Service identifier' }],
  options: [
    { flag: '--direction <d>', description: 'inbound|outbound|both (default both)', type: 'string' },
    { flag: '--depth <n>', description: 'Traversal depth (default 1)', type: 'number' },
  ],
  examples: ['nominal service graph payments --direction outbound --depth 2'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const raw = requirePositional(args, 0, 'service-id');
    const service = await resolveServiceId(config, raw, workspaceId);

    const direction = (getArgString(args, 'direction') ?? 'both') as Direction;
    if (!['inbound', 'outbound', 'both'].includes(direction)) {
      throw new Error('--direction must be inbound|outbound|both');
    }
    const depth = getArgNumber(args, 'depth') ?? 1;

    const api = new NominalAPI(config);
    const start = {
      id: service.id,
      provider: service.provider as Provider,
      account: service.account,
      region: service.region,
      type: service.type as NodeTypeArg,
    };

    const directions: NeighborsFn[] = direction === 'both' ? ['inbound', 'outbound'] : [direction];
    const rows: GraphRow[] = [];

    for (const dir of directions) {
      if (depth > 1) {
        const path = await api.cloudInfraNodesTraverse({
          workspaceId,
          start,
          neighborsFn: dir,
          maxDepth: depth,
        });
        for (const n of path) {
          rows.push({
            direction: dir,
            id: `${n.provider}/${n.account}/${n.region}/${n.type}/${n.id}`,
            type: n.type,
          });
        }
      } else {
        const result = await api.cloudInfraNodesListNeighbours({
          params: start,
          workspaceId,
          neighborsFn: dir,
          filters: {},
        });
        for (const n of result.items) {
          rows.push({
            direction: dir,
            id: `${n.provider}/${n.account}/${n.region}/${n.type}/${n.id}`,
            type: n.type,
          });
        }
      }
    }

    formatList(
      config,
      { items: rows, count: rows.length },
      {
        headers: ['Direction', 'ID', 'Type'],
        rows: (item) => [item.direction, item.id, item.type],
      }
    );
  },
};
