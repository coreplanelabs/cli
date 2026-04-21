import type { Config } from '../config/schema';
import type { GlobalFlags } from '../types/flags';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { promptText } from '../utils/prompt';
import { isInteractive } from '../utils/env';

export async function requireWorkspace(config: Config): Promise<string> {
  if (config.workspaceId) return config.workspaceId;
  throw new CLIError(
    'No workspace set',
    ExitCode.USAGE,
    'nominal workspace use <id>                     (set default)\n' +
      '        --workspace <id>                              (one-shot)\n' +
      '        NOMINAL_WORKSPACE_ID=<id>                     (environment variable)\n' +
      'List workspaces with: nominal workspace list'
  );
}

export function getPositional(args: Record<string, unknown>, index: number): string | undefined {
  const positional = args._;
  if (!Array.isArray(positional)) return undefined;
  const v = positional[index];
  return typeof v === 'string' ? v : undefined;
}

export function getAllPositional(args: Record<string, unknown>): string[] {
  const positional = args._;
  if (!Array.isArray(positional)) return [];
  return positional.filter((v): v is string => typeof v === 'string');
}

export function requirePositional(
  args: Record<string, unknown>,
  index: number,
  name: string
): string {
  const v = getPositional(args, index);
  if (v === undefined || v === '') {
    throw new CLIError(`Missing required argument: <${name}>`, ExitCode.USAGE);
  }
  return v;
}

export function parseDuration(value: string): number {
  const match = value.match(/^(\d+)\s*(ms|s|m|h|d|w)?$/i);
  if (!match) {
    throw new CLIError(
      `Invalid duration: "${value}"`,
      ExitCode.USAGE,
      'Use forms like 1h, 24h, 30m, 7d'
    );
  }
  const n = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return n * (multipliers[unit] ?? 1000);
}

export function requireArg(
  args: Record<string, unknown>,
  key: string,
  flag: string
): string {
  const value = args[key];
  if (typeof value === 'string' && value.length > 0) return value;
  throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE);
}

export async function promptIfMissing(
  config: Config,
  args: Record<string, unknown>,
  key: string,
  message: string,
  flag: string
): Promise<string> {
  const v = args[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (!isInteractive(config.nonInteractive)) {
    throw new CLIError(`Missing required flag: ${flag}`, ExitCode.USAGE);
  }
  return promptText({ nonInteractive: config.nonInteractive }, message);
}

export function getArgString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

export function getArgNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : undefined;
}

export function getArgBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function getArgArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key];
  if (Array.isArray(v)) {
    return v.filter((item): item is string => typeof item === 'string');
  }
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return undefined;
}

export function buildListQuery(flags: GlobalFlags): {
  perPage?: number;
  page?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
} {
  const q: {
    perPage?: number;
    page?: number;
    orderBy?: string;
    order?: 'asc' | 'desc';
  } = {};
  if (flags.perPage !== undefined) q.perPage = flags.perPage;
  if (flags.page !== undefined) q.page = flags.page;
  if (flags.orderBy !== undefined) q.orderBy = flags.orderBy;
  if (flags.order !== undefined) q.order = flags.order;
  return q;
}

export function parseJsonArg(raw: string | undefined, flag: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CLIError(`Invalid JSON in ${flag}: ${msg}`, ExitCode.USAGE);
  }
}
