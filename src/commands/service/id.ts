import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import type { InfrastructureNode } from '../../generated/types';

export type Provider =
  | 'aws'
  | 'vercel'
  | 'cloudflare'
  | 'fly'
  | 'render'
  | 'planetscale'
  | 'kubernetes'
  | 'unknown';

const VALID_PROVIDERS: Provider[] = [
  'aws',
  'vercel',
  'cloudflare',
  'fly',
  'render',
  'planetscale',
  'kubernetes',
  'unknown',
];

export interface ServiceId {
  provider: Provider;
  account: string;
  region: string;
  type: string;
  id: string;
}

export function parseServiceIdStrict(raw: string): ServiceId | null {
  const parts = raw.split('/');
  if (parts.length < 5) return null;
  const [provider, account, region, type, ...idParts] = parts;
  if (!provider || !VALID_PROVIDERS.includes(provider as Provider)) return null;
  return {
    provider: provider as Provider,
    account: account!,
    region: region!,
    type: type!,
    id: idParts.join('/'),
  };
}

export function formatServiceId(node: {
  provider: string;
  account: string;
  region: string;
  type: string;
  id: string;
}): string {
  return `${node.provider}/${node.account}/${node.region}/${node.type}/${node.id}`;
}

const NAME_FIELDS = ['id', 'name', 'alternate_names'] as const;
const DEFAULT_FIND_LIMIT = 50;

export interface FindServiceOptions {
  provider?: string;
  type?: string;
  limit?: number;
}

type NodesListApi = Pick<PolylaneAPI, 'cloudInfraNodesList'>;

// The graph joins clauses after the scope filters without parentheses, so an OR clause would
// escape provider/type. One LIKE query per name field, merged, keeps every match scoped.
export async function findServiceNodes(
  api: NodesListApi,
  workspaceId: string,
  query: string,
  opts: FindServiceOptions = {}
): Promise<InfrastructureNode[]> {
  const limit = opts.limit ?? DEFAULT_FIND_LIMIT;
  const filters = {
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.type ? { type: opts.type } : {}),
  };
  const results = await Promise.all(
    NAME_FIELDS.map((field) =>
      api.cloudInfraNodesList({
        workspaceId,
        clauses: [{ field, value: query, predicate: 'LIKE' }],
        ...(Object.keys(filters).length ? { filters } : {}),
        options: { limit },
      })
    )
  );
  const seen = new Set<string>();
  const merged: InfrastructureNode[] = [];
  for (const node of results.flatMap((r) => r.items)) {
    const key = formatServiceId(node);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(node);
  }
  return merged.slice(0, limit);
}

function isExactMatch(node: InfrastructureNode, raw: string): boolean {
  return node.id === raw || node.data?.name === raw || node.alternateNames?.includes(raw) === true;
}

function toServiceId(node: InfrastructureNode): ServiceId {
  return {
    provider: node.provider as Provider,
    account: node.account,
    region: node.region,
    type: node.type,
    id: node.id,
  };
}

export async function resolveServiceId(
  config: Config,
  raw: string,
  workspaceId: string,
  api: NodesListApi = new PolylaneAPI(config)
): Promise<ServiceId> {
  const strict = parseServiceIdStrict(raw);
  if (strict) return strict;

  const matches = await findServiceNodes(api, workspaceId, raw);

  if (matches.length === 0) {
    throw new CLIError(
      `No service found matching "${raw}"`,
      ExitCode.GENERAL,
      'polylane service find "<part of the name>"\n' +
        'or use the full form: <provider>/<account>/<region>/<type>/<id>'
    );
  }

  const exact = matches.filter((m) => isExactMatch(m, raw));
  if (exact.length === 1) return toServiceId(exact[0]!);
  if (matches.length === 1) return toServiceId(matches[0]!);

  const candidates = exact.length > 1 ? exact : matches;
  const topK = candidates.slice(0, 5).map((m) => `  ${formatServiceId(m)}`).join('\n');
  throw new CLIError(
    `Multiple services match "${raw}"`,
    ExitCode.USAGE,
    `Candidates:\n${topK}\n\nUse the full form to disambiguate.`
  );
}
