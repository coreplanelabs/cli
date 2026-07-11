import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { requestJson } from '../../client/http';
import { formatList } from '../../output/formatter';
import { formatOutput } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, getAllPositional, getArgNumber, getArgBoolean } from '../helpers';

interface CatalogEntry {
  name: string;
  summary: string;
  description: string;
  requiredIntegrations?: string[];
  requiredProviders?: string[];
  schema?: Record<string, unknown>;
}

interface SearchResult {
  results: CatalogEntry[];
  count: number;
  enums?: Record<string, string[]>;
}

const FIELDS = ['name', 'summary', 'requiredIntegrations', 'requiredProviders'];

export const toolsSearchCommand: Command = {
  name: 'tools search',
  description: 'Discover Polylane agent tools available to the workspace',
  operationId: 'agent_tools.search',
  positional: [{ name: 'query', description: 'Keywords to match tool names and descriptions', variadic: true }],
  options: [
    { flag: '--limit <n>', description: 'Max tools to return (1-25, default 10)', type: 'number' },
    { flag: '--full', description: 'Include full descriptions and JSON schemas', type: 'boolean' },
  ],
  examples: ['polylane tools search logs', 'polylane tools search "cloudflare telemetry" --full'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const query = getAllPositional(args).join(' ').trim();
    const limit = getArgNumber(args, 'limit');
    const full = getArgBoolean(args, 'full') === true;

    const result = await requestJson<SearchResult>(config, {
      url: `/v1/agent_tools/${workspaceId}`,
      query: { query: query || undefined, limit },
    });

    if (full) {
      formatOutput(config, result);
      return;
    }

    formatList(
      config,
      { items: projectItems(result.results as unknown as Array<Record<string, unknown>>, FIELDS), count: result.count },
      {
        headers: ['Name', 'Summary', 'Integrations', 'Providers'],
        rows: (item) => [
          String(item.name ?? ''),
          truncate(String(item.summary ?? ''), 60),
          Array.isArray(item.requiredIntegrations) ? item.requiredIntegrations.join(',') : '',
          Array.isArray(item.requiredProviders) ? item.requiredProviders.join(',') : '',
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
