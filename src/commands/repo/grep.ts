import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, requirePositional, getAllPositional, getArgNumber } from '../helpers';
import { resolveRepoId } from './id';

export const repoGrepCommand: Command = {
  name: 'repo grep',
  description: 'Semantic code search within a repository',
  operationId: 'repositories.codefiles.search',
  positional: [
    { name: 'repo-id', description: 'Repo ID, owner/name, or short name' },
    { name: 'prompt', description: 'Search query', variadic: true },
  ],
  options: [{ flag: '--limit <n>', description: 'Max chunks (default 20)', type: 'number' }],
  examples: ['nominal repo grep cli "http request handler"'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const repoRaw = requirePositional(args, 0, 'repo-id');
    const promptParts = getAllPositional(args).slice(1);
    if (promptParts.length === 0) {
      throw new Error('Missing <prompt>');
    }
    const prompt = promptParts.join(' ');
    const limit = getArgNumber(args, 'limit') ?? 20;

    const repoId = await resolveRepoId(config, repoRaw, workspaceId);
    const api = new NominalAPI(config);
    const chunks = await api.repositoriesCodefilesSearch(
      { workspaceId, id: repoId, prompt },
      { perPage: limit }
    );

    const items = chunks.map((c) => ({
      path: c.path,
      symbol: c.symbol ?? '',
      language: c.language,
      range: `${c.start}-${c.end}`,
      snippet: truncate(c.text, 200),
    }));

    formatList(
      config,
      { items, count: items.length },
      {
        headers: ['Path', 'Symbol', 'Lang', 'Range', 'Snippet'],
        rows: (item) => [
          String(item.path ?? ''),
          String(item.symbol ?? ''),
          String(item.language ?? ''),
          String(item.range ?? ''),
          String(item.snippet ?? ''),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\n+/g, ' ').replace(/\s+/g, ' ');
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}
