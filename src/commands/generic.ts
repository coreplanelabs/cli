import type { Command, OptionDef } from '../command';
import type { Config } from '../config/schema';
import type { GlobalFlags } from '../types/flags';
import type { OperationMeta } from '../generated/commands';
import { NominalAPI } from '../generated/client';
import { OPERATIONS } from '../generated/commands';
import { formatOutput, formatList } from '../output/formatter';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { buildListQuery, getArgString, parseJsonArg } from './helpers';

const SAFE_TAG_TO_GROUP: Record<string, string> = {
  Authentication: 'auth',
  'API Keys': 'api-key',
  'Telemetry Tokens': 'telemetry-token',
  Workspaces: 'workspace',
  'Workspace Members': 'member',
  Invites: 'invite',
  Teams: 'team',
  Labels: 'label',
  'Cloud Accounts': 'cloud-account',
  'Cloud Account Repositories': 'cloud-account-repo',
  'Cloud Infrastructure': 'infra',
  Repositories: 'repo',
  Threads: 'thread',
  Messages: 'message',
  Cases: 'case',
  Wikis: 'wiki',
  Memories: 'memory',
  Integrations: 'integration',
  'Service Catalog': 'service-catalog',
  Datasets: 'dataset',
  Automations: 'automation',
  'Automation Templates': 'automation-template',
  Notifications: 'notification',
  Sessions: 'session',
  OAuth: 'oauth',
  'OAuth Clients': 'oauth-client',
  'Permission Scopes': 'scope',
  Visibilities: 'visibility',
  Plans: 'plan',
  LlmProviders: 'llm-provider',
  Feedbacks: 'feedback',
  Ratings: 'rating',
  Artifacts: 'artifact',
  Search: 'search',
  Analytics: 'analytics',
};

function isPublicEndpoint(meta: OperationMeta): boolean {
  return meta.isPublic || meta.path.includes('/public/') || meta.operationId.includes('.public.');
}

function lastSegment(operationId: string): string {
  const parts = operationId.split('.');
  return parts[parts.length - 1] ?? operationId;
}

function commandVerb(meta: OperationMeta): string {
  const suffix = lastSegment(meta.operationId);
  const mapped: Record<string, string> = {
    list: 'list',
    get: 'get',
    post: 'create',
    create: 'create',
    put: 'update',
    patch: 'patch',
    delete: 'delete',
    del: 'delete',
    search: 'search',
    sync: 'sync',
    connect: 'connect',
    whoami: 'whoami',
    me: 'me',
    accept: 'accept',
    remove: 'remove',
    investigate: 'investigate',
    trigger: 'trigger',
    generate: 'generate',
    export: 'export',
  };
  if (mapped[suffix]) return mapped[suffix]!;

  if (meta.method === 'GET' && meta.pathParams.length === 0) return 'list';
  if (meta.method === 'GET') return 'get';
  if (meta.method === 'POST') return 'create';
  if (meta.method === 'PUT') return 'update';
  if (meta.method === 'PATCH') return 'patch';
  if (meta.method === 'DELETE') return 'delete';

  return suffix;
}

function getGroupName(meta: OperationMeta): string {
  const base = SAFE_TAG_TO_GROUP[meta.tag];
  if (base) {
    return isPublicEndpoint(meta) ? `public-${base}` : base;
  }
  return meta.tag.toLowerCase().replace(/\s+/g, '-');
}

function getCommandName(meta: OperationMeta): string {
  const group = getGroupName(meta);
  const verb = commandVerb(meta);
  // Qualify with extra path components if operationId has multiple parts past group
  const idParts = meta.operationId.split('.');
  const secondToLast = idParts[idParts.length - 2] ?? '';

  if (secondToLast && !['public'].includes(secondToLast) && idParts.length > 2) {
    const subGroup = secondToLast;
    if (subGroup !== verb) {
      return `${group} ${subGroup}-${verb}`;
    }
  }

  return `${group} ${verb}`;
}

function buildOptions(meta: OperationMeta): OptionDef[] {
  const options: OptionDef[] = [];

  for (const pp of meta.pathParams) {
    options.push({
      flag: `--${pp.replace(/_/g, '-')} <value>`,
      description: `Path parameter: ${pp}`,
      type: 'string',
      required: true,
    });
  }

  for (const qp of meta.queryParams) {
    if (['perPage', 'page', 'orderBy', 'order'].includes(qp.name)) continue;
    const kebab = qp.name.replace(/([A-Z])/g, '-$1').replace(/_/g, '-').toLowerCase();
    const hint = qp.enumValues && qp.enumValues.length > 0 ? ` (${qp.enumValues.join('|')})` : '';
    options.push({
      flag: `--${kebab} <value>`,
      description: `Query: ${qp.name}${hint}`,
      type: 'string',
      required: qp.required,
    });
  }

  if (meta.hasBody) {
    options.push({
      flag: '--body <json>',
      description: 'Request body as JSON string',
      type: 'string',
    });
    options.push({
      flag: '--body-file <path>',
      description: 'Request body from a JSON file ("-" for stdin)',
      type: 'string',
    });
  }

  return options;
}

function collectPositionalPath(meta: OperationMeta, args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pp of meta.pathParams) {
    const kebab = pp.replace(/([A-Z])/g, (_, c: string) => '-' + c.toLowerCase()).replace(/_/g, '-');
    const camel = kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    let value = getArgString(args, camel);
    if (value === undefined && pp === 'workspaceId') {
      // Let the API call method pick this up below (from config if not set)
      value = '';
    }
    if (value === undefined) {
      throw new CLIError(`Missing path parameter --${kebab}`, ExitCode.USAGE);
    }
    out[pp] = value;
  }
  return out;
}

function collectQuery(meta: OperationMeta, args: Record<string, unknown>, flags: GlobalFlags): Record<string, string | number | boolean | string[] | undefined | null> | undefined {
  if (meta.queryParams.length === 0) return undefined;
  const q: Record<string, string | number | boolean | string[] | undefined | null> = { ...buildListQuery(flags) };
  for (const qp of meta.queryParams) {
    if (['perPage', 'page', 'orderBy', 'order'].includes(qp.name)) continue;
    const kebab = qp.name.replace(/([A-Z])/g, '-$1').replace(/_/g, '-').toLowerCase();
    const camel = kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const raw = getArgString(args, camel);
    if (raw === undefined) continue;
    if (qp.type.includes('number')) q[qp.name] = Number(raw);
    else if (qp.type === 'boolean') q[qp.name] = raw === 'true';
    else q[qp.name] = raw;
  }
  return q;
}

async function readBodyFile(path: string): Promise<string> {
  if (path === '-') {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (c: Buffer) => chunks.push(c));
      process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      process.stdin.on('error', (err) => reject(err));
    });
  }
  const fs = await import('node:fs');
  return fs.readFileSync(path, 'utf-8');
}

async function resolveBody(args: Record<string, unknown>): Promise<unknown | undefined> {
  const rawInline = getArgString(args, 'body');
  if (rawInline !== undefined) return parseJsonArg(rawInline, '--body');
  const file = getArgString(args, 'bodyFile');
  if (file !== undefined) {
    const contents = await readBodyFile(file);
    return parseJsonArg(contents, '--body-file');
  }
  return undefined;
}

function callApiMethod(
  api: NominalAPI,
  methodName: string,
  pathArgs: Record<string, string>,
  meta: OperationMeta,
  body: unknown | undefined,
  query: Record<string, string | number | boolean | string[] | undefined | null> | undefined
): Promise<unknown> {
  const method = (api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[methodName];
  if (typeof method !== 'function') {
    throw new CLIError(`API method not found: ${methodName}`, ExitCode.GENERAL);
  }
  const callArgs: unknown[] = [];
  for (const pp of meta.pathParams) {
    callArgs.push(pathArgs[pp]);
  }
  if (meta.hasBody) callArgs.push(body ?? {});
  if (meta.queryParams.length > 0) callArgs.push(query ?? {});
  return method.apply(api, callArgs);
}

export function buildGenericCommand(meta: OperationMeta): Command {
  const name = getCommandName(meta);
  const options = buildOptions(meta);
  return {
    name,
    description: meta.summary || `${meta.method} ${meta.path}`,
    operationId: meta.operationId,
    usage: `nominal ${name} [options]`,
    options,
    async execute(config: Config, flags: GlobalFlags, args: Record<string, unknown>): Promise<void> {
      const api = new NominalAPI(config);

      // Auto-fill workspaceId from config if available
      if (meta.pathParams.includes('workspaceId') && !args.workspaceId && config.workspaceId) {
        args.workspaceId = config.workspaceId;
      }
      if (meta.queryParams.some((q) => q.name === 'workspaceId') && !args.workspaceId && config.workspaceId) {
        args.workspaceId = config.workspaceId;
      }

      const pathArgs = collectPositionalPath(meta, args);
      const query = collectQuery(meta, args, flags);
      const body = await resolveBody(args);

      if (meta.hasBody && body === undefined && !config.dryRun) {
        throw new CLIError(
          `Command requires a body. Use --body '<json>' or --body-file <path>`,
          ExitCode.USAGE
        );
      }

      const result = await callApiMethod(api, meta.methodName, pathArgs, meta, body, query);

      if (
        result !== null &&
        typeof result === 'object' &&
        'items' in result &&
        'count' in result
      ) {
        const list = result as { items: Record<string, unknown>[]; count: number };
        formatList(config, list);
        return;
      }

      formatOutput(config, result);
    },
  };
}

export function allGenericCommands(): Command[] {
  const seen = new Set<string>();
  const out: Command[] = [];
  for (const meta of Object.values(OPERATIONS)) {
    const name = getCommandName(meta);
    if (seen.has(name)) {
      // Disambiguate by appending method
      const alt = `${name}-${meta.method.toLowerCase()}`;
      if (seen.has(alt)) continue;
      seen.add(alt);
      out.push({ ...buildGenericCommand(meta), name: alt });
    } else {
      seen.add(name);
      out.push(buildGenericCommand(meta));
    }
  }
  return out;
}
