import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional } from '../helpers';

export const wikiFindCommand: Command = {
  name: 'wiki find',
  description: 'Search wiki documents across the workspace',
  operationId: 'search.global',
  positional: [{ name: 'prompt', description: 'Search query', variadic: true }],
  examples: ['nominal wiki find "how does auth work"'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'prompt');
    const prompt = getAllPositional(args).join(' ');

    const api = new NominalAPI(config);
    const results = await api.searchGlobal({ workspaceId, prompt });
    const docs = results.filter((r) => r.type === 'wiki_document');

    const items = docs.map((r) => ({ id: r.id, score: r.score, type: r.type }));
    formatList(
      config,
      { items, count: items.length },
      {
        headers: ['ID', 'Score', 'Type'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.score ?? ''),
          String(item.type ?? ''),
        ],
      }
    );
  },
};
