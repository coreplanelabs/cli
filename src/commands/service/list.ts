import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, getArgString, getArgNumber, getArgBoolean } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import type { Provider } from './id';
import type { InfrastructureNode } from '../../generated/types';

type NodeType = Parameters<PolylaneAPI['cloudInfraNodesList']>[0] extends { filters?: { type?: infer T } }
  ? T
  : never;
type NodeCategory = NonNullable<
  NonNullable<Parameters<PolylaneAPI['cloudInfraNodesList']>[0]['filters']>['category']
>;

const CATEGORIES: NodeCategory[] = [
  'compute',
  'storage',
  'database',
  'networking',
  'messaging',
  'security',
  'observability',
  'code',
  'identity',
  'other',
];

export const serviceListCommand: Command = {
  name: 'service list',
  description: 'List cloud infrastructure services',
  operationId: 'cloud_infra.nodes.list',
  options: [
    { flag: '--provider <p>', description: 'aws|vercel|cloudflare|fly|render|planetscale|kubernetes', type: 'string' },
    { flag: '--account <a>', description: 'Cloud account ID/slug', type: 'string' },
    { flag: '--region <r>', description: 'Cloud region', type: 'string' },
    { flag: '--type <t>', description: 'Resource type (e.g. aws.lambda.function)', type: 'string' },
    { flag: '--category <c>', description: 'compute|storage|database|networking|messaging|security|observability|code|identity|other', type: 'string' },
    { flag: '--limit <n>', description: 'Max items (default 20)', type: 'number' },
    { flag: '--full', description: 'Return full objects', type: 'boolean' },
  ],
  examples: [
    'polylane service list --provider aws --limit 50',
    'polylane service list --type aws.lambda.function',
    'polylane service list --category database',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const api = new PolylaneAPI(config);

    const provider = getArgString(args, 'provider') as Provider | undefined;
    const account = getArgString(args, 'account');
    const region = getArgString(args, 'region');
    const type = getArgString(args, 'type') as NodeType | undefined;
    const category = getArgString(args, 'category');
    const limit = getArgNumber(args, 'limit') ?? 20;
    const full = getArgBoolean(args, 'full') === true;

    if (category && !CATEGORIES.includes(category as NodeCategory)) {
      throw new CLIError(
        `Unknown category: ${category}`,
        ExitCode.USAGE,
        `Use one of: ${CATEGORIES.join(' | ')}`
      );
    }

    const filters: {
      provider?: Provider;
      account?: string;
      region?: string;
      type?: NodeType;
      category?: NodeCategory;
    } = {};
    if (provider) filters.provider = provider;
    if (account) filters.account = account;
    if (region) filters.region = region;
    if (type) filters.type = type;
    if (category) filters.category = category as NodeCategory;

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
      category: n.category,
      provider: n.provider,
      account: n.account,
      region: n.region,
      name: pickName(n),
    }));

    formatList(
      config,
      { items, count: result.count },
      {
        headers: ['ID', 'Type', 'Category', 'Provider', 'Account', 'Region', 'Name'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.type ?? ''),
          String(item.category ?? ''),
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
