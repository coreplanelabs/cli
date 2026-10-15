import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

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

export function resolveServiceId(raw: string): ServiceId {
  const strict = parseServiceIdStrict(raw);
  if (strict) return strict;

  throw new CLIError(
    `Invalid service ID "${raw}"`,
    ExitCode.USAGE,
    'Use the full form: <provider>/<account>/<region>/<type>/<id>\n' +
      'e.g. polylane service show aws/123456789/us-east-1/aws.lambda.function/payments'
  );
}
