import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const integrationRefreshToolsCommand: Command = {
  name: 'integration refresh-tools',
  description: 'Re-fetch the tool list from a connected MCP server',
  operationId: 'integrations.mcp.refreshTools',
  positional: [{ name: 'integration-id', description: 'The MCP integration ID' }],
  examples: ['nominal integration refresh-tools int_xxx'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'integration-id');
    const api = new NominalAPI(config);
    const integration = await api.integrationsMcpRefreshTools({ workspaceId, id });
    formatOutput(config, integration);
  },
};
