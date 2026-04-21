import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { projectItems } from '../../output/project';
import { requireWorkspace, requirePositional, getAllPositional } from '../helpers';

const FIELDS = ['id', 'name', 'owner', 'provider', 'status', 'description'];

export const repoFindCommand: Command = {
  name: 'repo find',
  description: 'Search repositories by natural-language prompt',
  operationId: 'repositories.search',
  positional: [{ name: 'prompt', description: 'Search query', variadic: true }],
  examples: ['nominal repo find "payment processing"'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    requirePositional(args, 0, 'prompt');
    const prompt = getAllPositional(args).join(' ');

    const api = new NominalAPI(config);
    const items = await api.repositoriesSearch({ workspaceId, prompt });
    const projected = projectItems(items as unknown as Array<Record<string, unknown>>, FIELDS);

    formatList(
      config,
      { items: projected, count: projected.length },
      {
        headers: ['ID', 'Name', 'Owner', 'Provider', 'Status', 'Description'],
        rows: (item) => [
          String(item.id ?? ''),
          String(item.name ?? ''),
          String(item.owner ?? ''),
          String(item.provider ?? ''),
          String(item.status ?? ''),
          truncate(String(item.description ?? ''), 60),
        ],
      }
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
