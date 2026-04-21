import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';

export type Provider = 'aws' | 'vercel' | 'cloudflare' | 'fly' | 'render' | 'unknown';

const VALID_PROVIDERS: Provider[] = ['aws', 'vercel', 'cloudflare', 'fly', 'render', 'unknown'];

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

export async function resolveServiceId(
  config: Config,
  raw: string,
  workspaceId: string
): Promise<ServiceId> {
  const strict = parseServiceIdStrict(raw);
  if (strict) return strict;

  const api = new NominalAPI(config);
  const matches = await api.cloudInfraNodesSearch({ workspaceId, prompt: raw });

  if (matches.length === 0) {
    throw new CLIError(
      `No service found matching "${raw}"`,
      ExitCode.GENERAL,
      'Use the full form: <provider>/<account>/<region>/<type>/<id>'
    );
  }

  if (matches.length === 1) {
    const m = matches[0]!;
    return {
      provider: m.provider as Provider,
      account: m.account,
      region: m.region,
      type: m.type,
      id: m.id,
    };
  }

  const topK = matches.slice(0, 5).map((m) => `  ${formatServiceId(m)}`).join('\n');
  throw new CLIError(
    `Multiple services match "${raw}"`,
    ExitCode.USAGE,
    `Candidates:\n${topK}\n\nUse the full form to disambiguate.`
  );
}
