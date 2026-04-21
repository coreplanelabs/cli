import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';
import type { Provider } from './id';
import type { InfrastructureNode } from '../../generated/types';

type NodeType = Parameters<NominalAPI['cloudInfraNodesList']>[0] extends { filters?: { type?: infer T } }
  ? T
  : never;

export const serviceListCommand: Command = {
  name: 'service list',
  description: 'List cloud infrastructure services',
  operationId: 'cloud_infra.nodes.list',
  options: [
    { flag: '--provider <p>', description: 'aws|vercel|cloudflare|fly|render', type: 'string' },
    { flag: '--account <a>', description: 'Cloud account ID/slug', type: 'string' },
    { flag: '--region <r>', description: 'Cloud region', type: 'string' },
    { flag: '--type <t>', description: 'Resource type (e.g. aws.lambda.function)', type: 'string' },
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: [
    'nominal service list --provider aws --limit 50',
    'nominal service list --type aws.lambda.function',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const api = new NominalAPI(config);

    const provider = getArgString(args, 'provider') as Provider | undefined;
    const account = getArgString(args, 'account');
    const region = getArgString(args, 'region');
    const type = getArgString(args, 'type') as NodeType | undefined;
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    const filters: { provider?: Provider; account?: string; region?: string; type?: NodeType } = {};
    if (provider) filters.provider = provider;
    if (account) filters.account = account;
    if (region) filters.region = region;
    if (type) filters.type = type;

    const result = await api.cloudInfraNodesList({
      workspaceId,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      options: { limit },
    });

    if (full) {
      formatList(config, result as { items: Array<Record<string, unknown>>; count: number });
      return;
    }

    const items = result.items.map((n: InfrastructureNode) => ({
      id: `${n.provider}/${n.account}/${n.region}/${n.type}/${n.id}`,
      type: n.type,
      provider: n.provider,
      account: n.account,
      region: n.region,
      name: pickName(n),
    }));

    formatList(
      config,
      { items, count: result.count },
      {
        headers: ['ID', 'Type', 'Provider', 'Account', 'Region', 'Name'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.type ?? ''),
          String(item.provider ?? ''),
          String(item.account ?? ''),
          String(item.region ?? ''),
          String(item.name ?? ''),
        ],
      }
    );
  },
};

function pickName(n: InfrastructureNode): string {
  const data = n.data;
  for (const key of ['name', 'Name', 'FunctionName', 'id', 'Id']) {
    const v = data[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return n.id;
}
