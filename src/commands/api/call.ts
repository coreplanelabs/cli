import { readFileSync, readSync } from 'node:fs';
import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { OPERATIONS, type OperationMeta } from '../../generated/commands';
import { NominalAPI } from '../../generated/client';
import { formatOutput, formatList } from '../../output/formatter';
import { requirePositional, getArgString, parseJsonArg } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

type ApiMethod = (...args: unknown[]) => Promise<unknown>;
type ApiRecord = Record<string, ApiMethod>;

function collectPathArgs(op: OperationMeta, args: Record<string, unknown>, config: Config): string[] {
  const values: string[] = [];
  for (const name of op.pathParams) {
    const kebab = kebabize(name);
    const camel = camelize(kebab);
    let value = getArgString(args, camel);
    if (value === undefined && name === 'workspaceId' && config.workspaceId) {
      value = config.workspaceId;
    }
    if (value === undefined) {
      throw new CLIError(
        `Missing path parameter --${kebab}`,
        ExitCode.USAGE,
        `Use \`nominal api describe ${op.operationId}\` for details`
      );
    }
    values.push(value);
  }
  return values;
}

function collectQueryArg(
  op: OperationMeta,
  args: Record<string, unknown>
): Record<string, string | number | boolean | string[] | undefined> | undefined {
  if (op.queryParams.length === 0) return undefined;

  const rawJson = getArgString(args, 'query');
  if (rawJson) {
    const parsed = parseJsonArg(rawJson, '--query');
    if (parsed === null || typeof parsed !== 'object') {
      throw new CLIError('--query must be a JSON object', ExitCode.USAGE);
    }
    return parsed as Record<string, string | number | boolean | string[]>;
  }

  const out: Record<string, string | number | boolean | string[]> = {};
  for (const qp of op.queryParams) {
    const kebab = kebabize(qp.name);
    const camel = camelize(kebab);
    const raw = getArgString(args, camel);
    if (raw === undefined) continue;
    if (qp.type.includes('number')) out[qp.name] = Number(raw);
    else if (qp.type === 'boolean') out[qp.name] = raw === 'true';
    else out[qp.name] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readBodyFromFile(path: string): string {
  if (path === '-') {
    const chunks: Buffer[] = [];
    const fd = 0;
    const buf = Buffer.alloc(65536);
    while (true) {
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, buf, 0, buf.length, null);
      } catch {
        break;
      }
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  return readFileSync(path, 'utf-8');
}

async function resolveBody(args: Record<string, unknown>): Promise<unknown> {
  const raw = getArgString(args, 'body');
  if (raw !== undefined) return parseJsonArg(raw, '--body');
  const file = getArgString(args, 'bodyFile');
  if (file !== undefined) return parseJsonArg(readBodyFromFile(file), '--body-file');
  return undefined;
}

function callMethod(
  api: NominalAPI,
  op: OperationMeta,
  pathArgs: string[],
  body: unknown,
  query: Record<string, string | number | boolean | string[] | undefined> | undefined
): Promise<unknown> {
  const method = (api as unknown as ApiRecord)[op.methodName];
  if (typeof method !== 'function') {
    throw new CLIError(`API method not found: ${op.methodName}`, ExitCode.GENERAL);
  }
  const callArgs: unknown[] = [...pathArgs];
  if (op.hasBody) callArgs.push(body ?? {});
  if (op.queryParams.length > 0) callArgs.push(query ?? {});
  return method.apply(api, callArgs);
}

export const apiCallCommand: Command = {
  name: 'api call',
  description: 'Invoke a raw API operation',
  positional: [{ name: 'operation-id', description: 'The operationId' }],
  options: [
    { flag: '--body <json>', description: 'Request body as JSON string', type: 'string' },
    { flag: '--body-file <path>', description: 'Request body from file ("-" for stdin)', type: 'string' },
    { flag: '--query <json>', description: 'Query params as JSON object', type: 'string' },
  ],
  examples: [
    'nominal api call workspaces.list',
    'nominal api call cases.post --body \'{"workspaceId":"ws_xxx","title":"..."}\' ',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const opId = requirePositional(args, 0, 'operation-id');
    const op = (Object.values(OPERATIONS) as OperationMeta[]).find((o) => o.operationId === opId);
    if (!op) {
      throw new CLIError(
        `Unknown operation: ${opId}`,
        ExitCode.USAGE,
        `Use \`nominal api list\` to find an operation`
      );
    }

    if (op.hasBody && getArgString(args, 'body') === undefined && getArgString(args, 'bodyFile') === undefined) {
      if (!config.dryRun) {
        throw new CLIError(
          `${opId} requires a body`,
          ExitCode.USAGE,
          `Use --body '<json>' or --body-file <path>`
        );
      }
    }

    const api = new NominalAPI(config);
    const pathArgs = collectPathArgs(op, args, config);
    const query = collectQueryArg(op, args);
    const body = await resolveBody(args);

    const result = await callMethod(api, op, pathArgs, body, query);

    if (
      result !== null &&
      typeof result === 'object' &&
      'items' in result &&
      'count' in result
    ) {
      formatList(config, result as { items: Array<Record<string, unknown>>; count: number });
      return;
    }
    formatOutput(config, result);
  },
};

function kebabize(name: string): string {
  return name.replace(/([A-Z])/g, '-$1').replace(/_/g, '-').toLowerCase();
}

function camelize(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
