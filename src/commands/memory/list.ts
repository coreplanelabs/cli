import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList } from '../../output/formatter';
import { requireWorkspace, getArgString } from '../helpers';

export const memoryListCommand: Command = {
  name: 'memory list',
  description: 'List files and folders in the workspace memory repository',
  operationId: 'memories.tree',
  options: [{ flag: '--path <dir>', description: 'Folder to list (default: repository root)', type: 'string' }],
  examples: ['polylane memory list', 'polylane memory list --path services'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const dir = (getArgString(args, 'path') ?? '').replace(/^\/+|\/+$/g, '');

    const api = new PolylaneAPI(config);
    const result = await api.memoriesTree(workspaceId, dir ? { path: dir } : undefined);

    const items = result.entries.map((e) => ({
      path: dir ? `${dir}/${e.name}` : e.name,
      type: e.type === 'tree' ? 'dir' : 'file',
    }));

    formatList(
      config,
      { items, count: items.length },
      {
        headers: ['Path', 'Type'],
        rows: (item) => [String(item.path), String(item.type)],
      }
    );
  },
};
