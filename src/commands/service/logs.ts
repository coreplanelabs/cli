import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgString, getArgNumber, parseDuration } from '../helpers';
import { resolveServiceId } from './id';

type NodeTypeArg = Parameters<NominalAPI['cloudInfraNodesLogs']>[0]['type'];

export const serviceLogsCommand: Command = {
  name: 'service logs',
  description: 'Fetch logs for a service',
  operationId: 'cloud_infra.nodes.logs',
  positional: [{ name: 'service-id', description: 'Service identifier' }],
  options: [
    { flag: '--since <dur>', description: 'How far back (default 1h). e.g. 15m, 1h, 24h, 7d', type: 'string' },
    { flag: '--limit <n>', description: 'Max log events (default 100)', type: 'number' },
    { flag: '--grep <q>', description: 'Full-text search within the logs', type: 'string' },
  ],
  examples: [
    'nominal service logs payments',
    'nominal service logs payments --since 24h --grep error',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const raw = requirePositional(args, 0, 'service-id');
    const service = await resolveServiceId(config, raw, workspaceId);

    const sinceStr = getArgString(args, 'since') ?? '1h';
    const sinceMs = parseDuration(sinceStr);
    const limit = getArgNumber(args, 'limit') ?? 100;
    const grep = getArgString(args, 'grep');

    const now = Math.floor(Date.now() / 1000);
    const from = Math.floor((Date.now() - sinceMs) / 1000);

    const api = new NominalAPI(config);
    const result = await api.cloudInfraNodesLogs({
      workspaceId,
      id: service.id,
      provider: service.provider,
      account: service.account,
      region: service.region,
      type: service.type as NodeTypeArg,
      from,
      to: now,
      limit,
      ...(grep ? { needle: { value: grep, matchCase: false } } : {}),
    });

    if (config.output === 'json') {
      formatOutput(config, result);
      return;
    }

    for (const entry of result.events) {
      const ts = new Date(entry.timestamp).toISOString();
      const msg = extractMessage(entry.event);
      process.stdout.write(`${ts}  ${msg}\n`);
    }
    if (result.events.length === 0) {
      process.stdout.write('(no events)\n');
    } else if (!config.quiet) {
      process.stdout.write(`\n${result.events.length} event${result.events.length === 1 ? '' : 's'}\n`);
    }
  },
};

function extractMessage(event: Record<string, unknown>): string {
  for (const key of ['message', 'msg', 'body', 'log', 'event']) {
    const v = event[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return JSON.stringify(event);
}
