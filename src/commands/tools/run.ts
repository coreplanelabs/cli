import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { requestJson } from '../../client/http';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getPositional, getArgString, getArgBoolean, parseJsonArg } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

interface RunEnvelope {
  success: boolean;
  durationMs: number;
  result?: unknown;
  error?: { message?: string } | string;
}

export const toolsRunCommand: Command = {
  name: 'tools run',
  description: 'Run a Polylane agent tool by name (discover names with `tools search`)',
  operationId: 'agent_tools.run',
  positional: [{ name: 'tool-name', description: 'Exact tool name from `tools search`' }],
  options: [
    { flag: '--params <json>', description: "The tool's arguments as a JSON object", type: 'string' },
    { flag: '--write', description: 'Allow write tools (needs a key/token with agent_tools:write)', type: 'boolean' },
  ],
  examples: [
    'polylane tools run findNodes --params \'{"query":"api"}\'',
    'polylane tools run cloudflareRunTelemetryQuery --params \'{"account":"...","dataset":"..."}\'',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'tool-name');
    const toolName = getPositional(args, 0) as string;

    const rawParams = getArgString(args, 'params');
    let params: Record<string, unknown> = {};
    if (rawParams) {
      const parsed = parseJsonArg(rawParams, '--params');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CLIError('--params must be a JSON object', ExitCode.USAGE, 'Example: --params \'{"query":"api"}\'');
      }
      params = parsed as Record<string, unknown>;
    }

    const allowWrites = getArgBoolean(args, 'write') === true;

    const envelope = await requestJson<RunEnvelope>(config, {
      url: '/v1/agent_tools/run',
      method: 'POST',
      body: { workspaceId, toolName, params },
      headers: allowWrites ? { 'x-polylane-allow-writes': 'true' } : undefined,
    });

    if (!envelope.success) {
      const message = typeof envelope.error === 'string' ? envelope.error : (envelope.error?.message ?? 'Tool call failed');
      throw new CLIError(message, ExitCode.GENERAL, 'Run `polylane tools search ' + toolName + '` to check the tool name and its schema');
    }

    formatOutput(config, envelope.result);
  },
};
