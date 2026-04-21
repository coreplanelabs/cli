import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString } from '../helpers';
import type { InfrastructureNode } from '../../generated/types';

export const serviceFindCommand: Command = {
  name: 'service find',
  description: 'Natural-language search over cloud infrastructure',
  operationId: 'cloud_infra.nodes.search',
  positional: [{ name: 'prompt', description: 'Search prompt', variadic: true }],
  options: [
    { flag: '--provider <p>', description: 'Restrict to a provider', type: 'string' },
    { flag: '--type <t>', description: 'Restrict to a resource type', type: 'string' },
  ],
  examples: ['nominal service find "lambda functions handling payments"'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'prompt');
    const prompt = getAllPositional(args).join(' ');

    const api = new NominalAPI(config);
    const provider = getArgString(args, 'provider');
    const type = getArgString(args, 'type');

    const items = await api.cloudInfraNodesSearch(
      { workspaceId, prompt },
      provider || type ? { provider, type } : undefined
    );

    const projected = items.map((n: InfrastructureNode) => ({
      id: `${n.provider}/${n.account}/${n.region}/${n.type}/${n.id}`,
      type: n.type,
      provider: n.provider,
      account: n.account,
      region: n.region,
    }));

    formatList(
      config,
      { items: projected, count: projected.length },
      {
        headers: ['ID', 'Type', 'Provider', 'Account', 'Region'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.type ?? ''),
          String(item.provider ?? ''),
          String(item.account ?? ''),
          String(item.region ?? ''),
        ],
      }
    );
  },
};
