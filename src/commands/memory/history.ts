import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, getArgNumber } from '../helpers';

export const memoryHistoryCommand: Command = {
  name: 'memory history',
  description: 'List recent commits to the workspace memory repository',
  operationId: 'memories.commits',
  options: [{ flag: '--limit <n>', description: 'Max commits (default 20)', type: 'number' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const limit = getArgNumber(args, 'limit') ?? 20;

    const api = new PolylaneAPI(config);
    const result = await api.memoriesCommits(workspaceId, { limit });

    const items = result.items.map((c) => ({
      hash: c.hash,
      subject: c.subject,
      author: c.authorName,
      committed: new Date(c.committedAt * 1000).toISOString(),
    }));

    formatList(
      config,
      { items, count: items.length },
      {
        headers: ['Commit', 'Subject', 'Author', 'Committed'],
        rows: (item) => [item.hash.slice(0, 7), item.subject, item.author, item.committed],
      }
    );
  },
};
