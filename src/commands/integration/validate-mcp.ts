import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, getArgString, promptIfMissing, parseJsonArg } from '../helpers';

export const integrationValidateMcpCommand: Command = {
  name: 'integration validate-mcp',
  description: 'Probe an MCP server and list its tools (without connecting it)',
  operationId: 'integrations.mcp.validate',
  options: [
    { flag: '--url <url>', description: 'MCP server URL', type: 'string' },
    { flag: '--transport <t>', description: 'http | sse (default: http)', type: 'string' },
    { flag: '--bearer-token <token>', description: 'Bearer token', type: 'string' },
    { flag: '--extra-headers <json>', description: 'Extra headers as JSON object', type: 'string' },
  ],
  examples: [
    'nominal integration validate-mcp --url https://mcp.example.com/sse',
    'nominal integration validate-mcp --url https://mcp.example.com/sse --bearer-token ...',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const url = await promptIfMissing(config, args, 'url', 'MCP server URL', '--url');
    const transport = (getArgString(args, 'transport') ?? undefined) as 'http' | 'sse' | undefined;
    const bearerToken = getArgString(args, 'bearerToken');
    const extraHeadersRaw = getArgString(args, 'extraHeaders');
    const extraHeaders = extraHeadersRaw
      ? (parseJsonArg(extraHeadersRaw, '--extra-headers') as Record<string, string>)
      : undefined;

    const api = new NominalAPI(config);
    const result = await api.integrationsMcpValidate({
      workspaceId,
      url,
      ...(transport ? { transport } : {}),
      ...(bearerToken ? { bearerToken } : {}),
      ...(extraHeaders ? { extraHeaders } : {}),
    });

    formatOutput(config, result);
  },
};
