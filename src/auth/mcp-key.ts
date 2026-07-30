import { hostname } from 'node:os';

import type { Config } from '../config/schema';
import { tryResolveCredential } from './resolver';
import { loadConfigFile, writeConfigFile } from '../config/loader';
import { requestJson } from '../client/http';

export interface McpKeyResult {
  key: string;
  minted: boolean;
}

export function mcpKeyName(): string {
  return `cli-mcp-${hostname()}`.slice(0, 64);
}

export async function ensureMcpApiKey(config: Config): Promise<McpKeyResult | null> {
  const cred = await tryResolveCredential(config);
  if (!cred) return null;
  if (cred.type === 'api-key') return { key: cred.key, minted: false };

  const file = loadConfigFile();
  if (file?.mcp_api_key) return { key: file.mcp_api_key, minted: false };

  if (config.dryRun || !config.workspaceId) return null;
  try {
    const created = await requestJson<{ id: string; token: string }>(config, {
      method: 'POST',
      url: '/v1/api_keys',
      body: { workspaceId: config.workspaceId, name: mcpKeyName(), scopes: ['agent_tools:read'] },
    });
    if (!created.token) return null;
    writeConfigFile({ mcp_api_key: created.token, mcp_api_key_id: created.id });
    return { key: created.token, minted: true };
  } catch {
    return null;
  }
}
