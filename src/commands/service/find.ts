import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgString } from '../helpers';
import { findServiceNodes, formatServiceId } from './id';

export const serviceFindCommand: Command = {
  name: 'service find',
  description: 'Find cloud infrastructure by part of its id, name or alternate name',
  operationId: 'cloud_infra.nodes.list',
  positional: [{ name: 'query', description: 'Part of the id, name or alternate name', variadic: true }],
  options: [
    { flag: '--provider <p>', description: 'Restrict to a provider', type: 'string' },
    { flag: '--type <t>', description: 'Restrict to a resource type', type: 'string' },
  ],
  examples: ['polylane service find payments', 'polylane service find api --provider cloudflare'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'query');
    const query = getAllPositional(args).join(' ');

    const api = new PolylaneAPI(config);
    const provider = getArgString(args, 'provider');
    const type = getArgString(args, 'type');

    const { nodes: items, truncated } = await findServiceNodes(api, workspaceId, query, { provider, type });

    const projected = items.map((n) => ({
      id: formatServiceId(n),
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
    // On stderr, so stdout stays the list a script can parse.
    if (truncated && !config.quiet) {
      process.stderr.write(`More services match "${query}" than shown. Narrow the query, or add --provider or --type.\n`);
    }
  },
};
