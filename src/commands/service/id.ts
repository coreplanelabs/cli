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

interface NodeLookup {
  nodes: InfrastructureNode[];
  /** A field stopped before reading every row, so more nodes may match than were returned. */
  truncated: boolean;
}

// The graph wraps a LIKE value in % only when it holds no % or _, so a query with an
// underscore would be matched as a whole value. Sending the pattern ourselves keeps it a
// substring match; the _ it carries is a one-character wildcard, so containsQuery drops the
// extra rows that lets through (case-insensitive, like SQLite's LIKE).
function containsQuery(node: InfrastructureNode, query: string): boolean {
  const q = query.toLowerCase();
  const names = [node.id, node.data?.name, ...(node.alternateNames ?? [])];
  return names.some((n) => typeof n === 'string' && n.toLowerCase().includes(q));
}

function isExactMatch(node: InfrastructureNode, raw: string): boolean {
  return node.id === raw || node.data?.name === raw || node.alternateNames?.includes(raw) === true;
}

// Rows are read in pages, ordered by id so offsets are stable, until a field has `limit`
// kept matches or runs out. The cap bounds the work when `_` wildcards match many rows that
// containsQuery then drops; a field that hits it counts as truncated.
const PAGE_SIZE = 200;
const MAX_PAGES = 10;

// The graph joins clauses after the scope filters without parentheses, so an OR clause would
// escape provider/type. One query per name field, merged, keeps every match scoped.
async function lookupNodes(
  api: NodesListApi,
  workspaceId: string,
  query: string,
  mode: 'exact' | 'substring',
  opts: FindServiceOptions = {}
): Promise<NodeLookup> {
  const limit = opts.limit ?? DEFAULT_FIND_LIMIT;
  const filters = {
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.type ? { type: opts.type } : {}),
  };
  const clause =
    mode === 'exact'
      ? { value: query, predicate: '=' as const }
      : { value: `%${query}%`, predicate: 'LIKE' as const };
  const keep = mode === 'exact' ? isExactMatch : containsQuery;

  const scanField = async (field: (typeof NAME_FIELDS)[number]): Promise<NodeLookup> => {
    const nodes: InfrastructureNode[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { items } = await api.cloudInfraNodesList({
        workspaceId,
        clauses: [{ field, ...clause }],
        ...(Object.keys(filters).length ? { filters } : {}),
        options: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, orderBy: 'id' },
      });
      for (const node of items) {
        if (!keep(node, query)) continue;
        nodes.push(node);
        if (nodes.length >= limit) return { nodes, truncated: true };
      }
      if (items.length < PAGE_SIZE) return { nodes, truncated: false };
    }
    return { nodes, truncated: true };
  };

  const results = await Promise.all(NAME_FIELDS.map(scanField));
  const seen = new Set<string>();
  const nodes: InfrastructureNode[] = [];
  for (const node of results.flatMap((r) => r.nodes)) {
    const key = formatServiceId(node);
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(node);
  }
  return { nodes, truncated: results.some((r) => r.truncated) };
}

/** Services whose id, name or an alternate name contains the query, for `service find`. */
export async function findServiceNodes(
  api: NodesListApi,
  workspaceId: string,
  query: string,
  opts: FindServiceOptions = {}
): Promise<InfrastructureNode[]> {
  const { nodes } = await lookupNodes(api, workspaceId, query, 'substring', opts);
  return nodes.slice(0, opts.limit ?? DEFAULT_FIND_LIMIT);
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

  // Exact matches are queried on their own, before any substring page is cut, so a long
  // list of partial matches can neither hide the exact one nor make a shared name look unique.
  const exact = await lookupNodes(api, workspaceId, raw, 'exact');
  if (exact.nodes.length === 1) return toServiceId(exact.nodes[0]!);
  if (exact.nodes.length > 1) throw multipleMatches(raw, exact.nodes);

  const partial = await lookupNodes(api, workspaceId, raw, 'substring');
  if (partial.nodes.length === 0) {
    throw new CLIError(
      `No service found matching "${raw}"`,
      ExitCode.GENERAL,
      'polylane service find "<part of the name>"\n' +
        'or use the full form: <provider>/<account>/<region>/<type>/<id>'
    );
  }
  if (partial.nodes.length === 1 && !partial.truncated) return toServiceId(partial.nodes[0]!);
  throw multipleMatches(raw, partial.nodes);
}

function multipleMatches(raw: string, candidates: InfrastructureNode[]): CLIError {
  const topK = candidates.slice(0, 5).map((m) => `  ${formatServiceId(m)}`).join('\n');
  return new CLIError(
    `Multiple services match "${raw}"`,
    ExitCode.USAGE,
    `Candidates:\n${topK}\n\nUse the full form to disambiguate.`
  );
}
